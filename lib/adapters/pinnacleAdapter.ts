// The adapter pattern for SIGNALS' "sharp" baseline. The user hasn't
// upgraded to a paid odds API yet, so real Pinnacle data isn't available —
// everything downstream (devigging, sizing, detection) is built against
// this standardized PinnacleOdds shape so the real feed can be swapped in
// later by changing ONE environment variable (PINNACLE_SOURCE), with zero
// refactoring of any consumer.
import type { SupabaseClient } from "@supabase/supabase-js";
import { americanToImpliedProb } from "@/lib/utils/noVigCalculator";
import { getLatestGamesWithOdds } from "@/lib/odds";
import type { MarketType } from "@/types/odds";

export interface PinnacleOdds {
  canonicalId: string; // LAF's own games.id, stringified — a single already-unified integer id across every book, unlike quant_engine's cross-source string scheme
  marketType: MarketType;
  point: number | null; // spread/total line; null for h2h
  outcomeName: string;
  decimalOdds: number;
}

export abstract class PinnacleAdapter {
  abstract getOdds(sport: string): Promise<PinnacleOdds[]>;
}

// Books whose odds feed the synthetic "sharp" baseline — real sportsbooks
// only. Excludes Kalshi/Polymarket (prediction markets, evaluated as
// execution venues downstream, not baseline inputs) and excludes
// Pinnacle/Circa themselves (there's no real data there to average).
const CONSENSUS_INPUT_BOOKS = new Set(["fanduel", "draftkings", "betmgm"]);

interface OutcomeGroupKey {
  gameId: number;
  marketType: MarketType;
  point: number | null;
}

function groupKey(k: OutcomeGroupKey): string {
  return `${k.gameId}|${k.marketType}|${k.point ?? "ml"}`;
}

// Shared core: averages implied probabilities across whichever consensus
// input books are present for each (game, market, point) group, then
// proportionally tightens the group's total overround by marginTighten
// (e.g. 0.02 = 2 percentage points), preserving the relative odds ratios
// between outcomes — the same shrink-toward-de-vigged spirit as
// multiplicativeDevig, just applied partially rather than all the way,
// since real Pinnacle/Circa lines still carry some (much smaller) margin
// themselves.
//
// LIMITATION, documented rather than silently buried: if one of these same
// books (e.g. FanDuel) is later evaluated as an execution venue in the
// detection route, its EV is being compared against a baseline partially
// derived from its own price — a real circularity that shrinks (but,
// because this is an average across up to 3 books, doesn't zero out) the
// apparent edge. This is exactly why SIGNALS' simulated-mode output is
// locked from execution.
async function deriveMockSharpLine(
  supabase: SupabaseClient,
  sport: string,
  marginTighten: number
): Promise<PinnacleOdds[]> {
  const { data: sportRow, error: sportError } = await supabase.from("sports").select("id").eq("slug", sport).single();
  if (sportError || !sportRow) return [];

  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select("id, external_id, home_team, away_team, commence_time, status, sport_id, sports(slug)")
    .eq("sport_id", sportRow.id);
  if (gamesError || !games || games.length === 0) return [];

  const gamesWithOdds = await getLatestGamesWithOdds(
    supabase,
    games.map((g) => ({ ...g, sports: g.sports as unknown as { slug: string } | null }))
  );

  const groups = new Map<string, { key: OutcomeGroupKey; outcomes: Map<string, number[]> }>();

  for (const game of gamesWithOdds) {
    for (const line of game.odds) {
      if (!CONSENSUS_INPUT_BOOKS.has(line.bookSlug)) continue;

      const key: OutcomeGroupKey = { gameId: game.id, marketType: line.marketType, point: line.point };
      const gKey = groupKey(key);
      const group = groups.get(gKey) ?? { key, outcomes: new Map<string, number[]>() };
      const probs = group.outcomes.get(line.outcomeName) ?? [];
      probs.push(americanToImpliedProb(line.price));
      group.outcomes.set(line.outcomeName, probs);
      groups.set(gKey, group);
    }
  }

  const result: PinnacleOdds[] = [];
  for (const { key, outcomes } of groups.values()) {
    if (outcomes.size < 2) continue; // need the full market to devig/tighten meaningfully

    const outcomeNames = [...outcomes.keys()];
    const rawProbs = outcomeNames.map((name) => {
      const probs = outcomes.get(name)!;
      return probs.reduce((s, p) => s + p, 0) / probs.length; // average across contributing books
    });

    const total = rawProbs.reduce((s, p) => s + p, 0);
    const tightenedTotal = Math.max(1.0, total - marginTighten);
    const scale = tightenedTotal / total;

    outcomeNames.forEach((name, i) => {
      const tightenedProb = rawProbs[i] * scale;
      result.push({
        canonicalId: String(key.gameId),
        marketType: key.marketType,
        point: key.point,
        outcomeName: name,
        decimalOdds: 1 / tightenedProb,
      });
    });
  }

  return result;
}

// THIS DATA IS NOT TRADEABLE. Derives a synthetic "sharp" Pinnacle line from
// Action Network sportsbook odds already sitting in Supabase, tightening the
// aggregate margin ~2 percentage points to approximate how much tighter
// Pinnacle typically runs versus a retail -110 book.
export class MockPinnacleAdapter extends PinnacleAdapter {
  constructor(private supabase: SupabaseClient) {
    super();
  }

  async getOdds(sport: string): Promise<PinnacleOdds[]> {
    return deriveMockSharpLine(this.supabase, sport, 0.02);
  }
}

// THIS DATA IS NOT TRADEABLE. A second synthetic sharp source, standing in
// for Circa (LAF has no real Circa integration, same as quant_engine's own
// mocked Circa this session) — same underlying book pool as
// MockPinnacleAdapter, tightened 1.5 points instead of 2 so the two mock
// "sharp" lines are correlated but not identical, which is what makes
// averaging them in consensusDevig meaningful rather than redundant.
export async function getMockCircaOdds(supabase: SupabaseClient, sport: string): Promise<PinnacleOdds[]> {
  return deriveMockSharpLine(supabase, sport, 0.015);
}

// TODO: complete when PINNACLE_SOURCE=odds_api. Real, documented endpoint
// (verified this session building quant_engine's own ingestion/odds_api.py):
//   GET https://api.the-odds-api.com/v4/sports/{sport_key}/odds
//   query params: apiKey, regions=us,us2 (Pinnacle is listed under us2),
//     markets=h2h, bookmakers=pinnacle, oddsFormat=decimal
//   sport_key mapping: MLB -> "baseball_mlb", WNBA -> "basketball_wnba"
// Requesting oddsFormat=decimal means no American->decimal conversion is
// needed on this path (unlike MockPinnacleAdapter, which must convert
// since Action Network's stored prices are American). Map each event's
// bookmakers[].markets[].outcomes[] into PinnacleOdds using games.external_id
// to resolve canonicalId, the same way runScrape.ts already resolves
// incoming odds against existing games.
export class OddsApiPinnacleAdapter extends PinnacleAdapter {
  async getOdds(sport: string): Promise<PinnacleOdds[]> {
    void sport; // required to satisfy the PinnacleAdapter interface; unused until this TODO is finished
    throw new Error(
      "OddsApiPinnacleAdapter is not implemented yet. Set PINNACLE_SOURCE=mock until this is finished, " +
        "or complete it yourself following the TODO in lib/adapters/pinnacleAdapter.ts."
    );
  }
}

export function getPinnacleAdapter(supabase: SupabaseClient): PinnacleAdapter {
  const source = process.env.PINNACLE_SOURCE ?? "mock";
  if (source === "odds_api") return new OddsApiPinnacleAdapter();
  return new MockPinnacleAdapter(supabase);
}

export function isSimulatedMode(): boolean {
  return (process.env.PINNACLE_SOURCE ?? "mock") !== "odds_api";
}
