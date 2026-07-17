// Core SIGNALS detection logic — separated from app/api/signals/detect/route.ts
// the same way lib/utils/arbDetection.ts is separated from ARB's route, so
// lib/runScrape.ts can call this directly in-process on every real 5-minute
// scrape cycle, not just via an HTTP round-trip to itself.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLatestGamesWithOdds } from "@/lib/odds";
import { americanToImpliedProb } from "@/lib/utils/noVigCalculator";
import { getPinnacleAdapter, getMockCircaOdds, isSimulatedMode, type PinnacleOdds } from "@/lib/adapters/pinnacleAdapter";
import { consensusDevig, type ConsensusDevigResult } from "./devigging";
import { evPercent, expectedProfit, kellyStake, projectedIrr } from "./sizing";
import { withinVelocityWindow, prioritizeUrgent } from "./velocity";
import { buildSignalEmbed, sendDiscordAlert, shouldAlert } from "./discord";
import type { DetectSignalsResponse, SignalOpportunity, SignalPerBookBreakdown, SignalSide } from "@/types/signals";

const PHASE_1_SPORTS = ["mlb", "wnba"];
const EXECUTION_VENUES = new Set(["kalshi", "polymarket", "fanduel", "draftkings", "betmgm"]);
const EV_FLOOR = 0.01; // 1% floor stored server-side; the UI's slider filters higher client-side
const STARTING_BANKROLL = Number(process.env.STARTING_BANKROLL ?? 10000);
const KELLY_FRACTION_ENV = Number(process.env.KELLY_FRACTION ?? 0.25);
const ALERT_THRESHOLD = Number(process.env.SIGNALS_ALERT_THRESHOLD ?? 0.03);
const RECENT_ALERT_LOOKBACK_MINUTES = 30;

function groupByGame(odds: PinnacleOdds[]): Map<number, PinnacleOdds[]> {
  const byGame = new Map<number, PinnacleOdds[]>();
  for (const o of odds) {
    if (o.marketType !== "h2h") continue; // Phase 1 scope: h2h only
    const gameId = Number(o.canonicalId);
    const list = byGame.get(gameId) ?? [];
    list.push(o);
    byGame.set(gameId, list);
  }
  return byGame;
}

// 1 - every probability in a ConsensusDevigResult, preserving structure —
// used to turn "conservative P(outcome0), MAX-aggregated" (the buy_no
// evaluation) into "conservative P(outcome1)", since every de-vig model
// here already returns exactly-complementary probabilities for a 2-way
// market (P(outcome0) + P(outcome1) = 1 by construction in every one of the
// 5 models), so complementing after aggregating is equivalent to — and
// simpler than — re-running the whole model set against outcome1 directly.
function complement(result: ConsensusDevigResult): ConsensusDevigResult {
  const perModelBreakdown: SignalPerBookBreakdown = {};
  for (const [book, models] of Object.entries(result.perModelBreakdown)) {
    perModelBreakdown[book] = {
      multiplicative: 1 - models.multiplicative,
      additive: 1 - models.additive,
      power: 1 - models.power,
      probit: 1 - models.probit,
      shin: 1 - models.shin,
    };
  }
  const worstCaseUsed: Record<string, number> = {};
  for (const [book, v] of Object.entries(result.worstCaseUsed)) worstCaseUsed[book] = 1 - v;

  return { consensusProb: 1 - result.consensusProb, perModelBreakdown, worstCaseUsed };
}

interface CandidateSide {
  outcomeName: string;
  side: SignalSide;
  result: ConsensusDevigResult;
}

// A row about to be inserted, plus the extra context (not all of it stored
// in signal_opportunities' own columns — home/away team names are derivable
// via a join with games at read time, so aren't duplicated into the table)
// that building the Discord alert embed needs.
interface PendingRow {
  dbRow: {
    game_id: number;
    canonical_id: string;
    sport: string;
    market_type: "h2h";
    outcome_name: string;
    side: SignalSide;
    execution_venue: string;
    offered_price: number;
    consensus_prob: number;
    per_model_breakdown: SignalPerBookBreakdown;
    ev_percent: number;
    kelly_stake: number;
    expected_profit: number;
    is_simulated: boolean;
    expires_at: string;
  };
  homeTeam: string;
  awayTeam: string;
  worstCaseUsed: Record<string, number>;
  isUrgent: boolean;
  projectedIrr: number;
}

export async function runSignalsDetection(supabase: SupabaseClient): Promise<DetectSignalsResponse> {
  const simulated = isSimulatedMode();
  const pinnacleAdapter = getPinnacleAdapter(supabase);
  const now = new Date();

  let opportunitiesFound = 0;
  let topEv: number | null = null;

  for (const sport of PHASE_1_SPORTS) {
    let pinnacleOdds: PinnacleOdds[] = [];
    let circaOdds: PinnacleOdds[] = [];
    try {
      [pinnacleOdds, circaOdds] = await Promise.all([pinnacleAdapter.getOdds(sport), getMockCircaOdds(supabase, sport)]);
    } catch (err) {
      console.error(`[signals/detect] Failed to load sharp baseline for ${sport}:`, err instanceof Error ? err.message : err);
      continue;
    }
    if (pinnacleOdds.length === 0) continue;

    const { data: sportRow } = await supabase.from("sports").select("id").eq("slug", sport).single();
    if (!sportRow) continue;

    const { data: games } = await supabase
      .from("games")
      .select("id, external_id, home_team, away_team, commence_time, status, sport_id, sports(slug)")
      .eq("sport_id", sportRow.id);
    if (!games || games.length === 0) continue;

    const gamesWithOdds = await getLatestGamesWithOdds(
      supabase,
      games.map((g) => ({ ...g, sports: g.sports as unknown as { slug: string } | null }))
    );
    const gameById = new Map(gamesWithOdds.map((g) => [g.id, g]));

    const pinnacleByGame = groupByGame(pinnacleOdds);
    const circaByGame = groupByGame(circaOdds);

    for (const [gameId, pinnacleOutcomes] of pinnacleByGame) {
      const game = gameById.get(gameId);
      if (!game || game.status !== "upcoming") continue;
      if (!withinVelocityWindow(game.commenceTime, now)) continue;

      const outcomeNames = pinnacleOutcomes.map((o) => o.outcomeName);
      if (outcomeNames.length !== 2) continue; // Phase 1: 2-way h2h markets only

      const circaOutcomes = circaByGame.get(gameId);
      const booksOdds: Record<string, number[]> = { pinnacle: pinnacleOutcomes.map((o) => o.decimalOdds) };
      if (circaOutcomes && circaOutcomes.length === outcomeNames.length) {
        booksOdds.circa = circaOutcomes.map((o) => o.decimalOdds);
      }

      const yesResult = consensusDevig(booksOdds, "buy_yes", 0);
      const noResult = complement(consensusDevig(booksOdds, "buy_no", 0));

      const candidates: CandidateSide[] = [
        { outcomeName: outcomeNames[0], side: "yes", result: yesResult },
        { outcomeName: outcomeNames[1], side: "no", result: noResult },
      ];

      const isUrgent = prioritizeUrgent(game.commenceTime, now);
      const pendingRows: PendingRow[] = [];

      for (const candidate of candidates) {
        const venueLines = game.odds.filter(
          (l) => l.marketType === "h2h" && l.outcomeName === candidate.outcomeName && EXECUTION_VENUES.has(l.bookSlug)
        );

        for (const line of venueLines) {
          const offeredPrice = americanToImpliedProb(line.price);
          const ev = evPercent(candidate.result.consensusProb, offeredPrice);
          if (ev < EV_FLOOR) continue;

          const stake = kellyStake(candidate.result.consensusProb, offeredPrice, STARTING_BANKROLL, KELLY_FRACTION_ENV);
          const profit = expectedProfit(stake, candidate.result.consensusProb, offeredPrice);
          const irr = projectedIrr(ev);

          if (topEv === null || ev > topEv) topEv = ev;
          opportunitiesFound++;

          pendingRows.push({
            dbRow: {
              game_id: game.id,
              canonical_id: String(game.id),
              sport: sport.toUpperCase(),
              market_type: "h2h",
              outcome_name: candidate.outcomeName,
              side: candidate.side,
              execution_venue: line.bookSlug,
              offered_price: offeredPrice,
              consensus_prob: candidate.result.consensusProb,
              per_model_breakdown: candidate.result.perModelBreakdown,
              ev_percent: ev,
              kelly_stake: stake,
              expected_profit: profit,
              is_simulated: simulated,
              expires_at: game.commenceTime,
            },
            homeTeam: game.homeTeam,
            awayTeam: game.awayTeam,
            worstCaseUsed: candidate.result.worstCaseUsed,
            isUrgent,
            projectedIrr: irr,
          });
        }
      }

      if (pendingRows.length === 0) continue;

      // Dedup check: look up each candidate's most recent same (game, side,
      // venue) row before inserting, so shouldAlert() can compare against
      // its previous EV. Historical log, not a true upsert (matches
      // arbitrage_opportunities' own established insert-every-cycle
      // pattern) — there's no unique constraint to upsert against.
      for (const pending of pendingRows) {
        const { dbRow } = pending;
        const { data: previousRows } = await supabase
          .from("signal_opportunities")
          .select("ev_percent, detected_at")
          .eq("game_id", dbRow.game_id)
          .eq("side", dbRow.side)
          .eq("execution_venue", dbRow.execution_venue)
          .gte("detected_at", new Date(now.getTime() - RECENT_ALERT_LOOKBACK_MINUTES * 60 * 1000).toISOString())
          .order("detected_at", { ascending: false })
          .limit(1);

        const previousEv = previousRows && previousRows.length > 0 ? Number(previousRows[0].ev_percent) : null;

        const { data: inserted, error: insertError } = await supabase.from("signal_opportunities").insert(dbRow).select("id").single();
        if (insertError) {
          console.error("[signals/detect] Failed to insert signal_opportunities row:", insertError.message);
          continue;
        }

        if (shouldAlert(previousEv, dbRow.ev_percent, ALERT_THRESHOLD)) {
          const opp: SignalOpportunity = {
            id: inserted.id,
            gameId: dbRow.game_id,
            canonicalId: dbRow.canonical_id,
            sport: dbRow.sport,
            marketType: "h2h",
            homeTeam: pending.homeTeam,
            awayTeam: pending.awayTeam,
            outcomeName: dbRow.outcome_name,
            side: dbRow.side,
            executionVenue: dbRow.execution_venue,
            offeredPrice: dbRow.offered_price,
            consensusProb: dbRow.consensus_prob,
            perModelBreakdown: dbRow.per_model_breakdown,
            worstCaseUsed: pending.worstCaseUsed,
            evPercent: dbRow.ev_percent,
            kellyStakeDollars: dbRow.kelly_stake,
            expectedProfit: dbRow.expected_profit,
            projectedIrr: pending.projectedIrr,
            isSimulated: simulated,
            detectedAt: new Date().toISOString(),
            expiresAt: dbRow.expires_at,
            isUrgent: pending.isUrgent,
          };
          const embed = buildSignalEmbed(opp, simulated ? "SIMULATED" : "LIVE", STARTING_BANKROLL);
          await sendDiscordAlert(embed);
        }
      }
    }
  }

  return { opportunitiesFound, simulated, topEv };
}
