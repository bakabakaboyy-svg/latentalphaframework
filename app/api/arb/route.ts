import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getLatestGamesWithOdds } from "@/lib/odds";
import { detectAllArbs } from "@/lib/utils/arbDetection";
import type { ArbOpportunity, ArbResponse, ArbStats, MarketType } from "@/types/odds";

const DEFAULT_MIN_ARB_PERCENTAGE = 0.5;
const STATS_WINDOW_HOURS = 24;
const MARKET_LABELS: Record<string, string> = { h2h: "MONEYLINE", spreads: "SPREAD", totals: "TOTAL" };

function emptyResponse(error?: string): ArbResponse {
  return {
    arbitrageOpportunities: [],
    totalArbsAvailable: 0,
    highestArbPercentage: null,
    stats: {
      totalDetected24h: 0,
      activeNow: 0,
      highestArbPercentage24h: null,
      mostCommonMarket: null,
      mostProfitableBookPair: null,
    },
    error,
  };
}

// Historical arbitrage_opportunities rows over the last 24h, summarized for
// the ARB tab's stats card. Independent of the live detection pass below —
// this is a log of everything the scraper has seen recently, not "right now."
async function computeStats(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  activeIds: Set<string>
): Promise<ArbStats> {
  const cutoff = new Date(Date.now() - STATS_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from("arbitrage_opportunities")
    .select("game_id, market_type, point, book_a, book_b, arb_percentage, detected_at")
    .gte("detected_at", cutoff);

  if (error) throw new Error(`Failed to load arbitrage_opportunities: ${error.message}`);
  const history = rows ?? [];

  if (history.length === 0) {
    // Nothing logged yet in the window — "still active" is only meaningful
    // relative to history, so it's 0 here, not every currently-live arb.
    return { totalDetected24h: 0, activeNow: 0, highestArbPercentage24h: null, mostCommonMarket: null, mostProfitableBookPair: null };
  }

  let highest = 0;
  const marketCounts = new Map<string, number>();
  const pairTotals = new Map<string, { sum: number; count: number }>();
  const activeGameMarketPoints = new Set<string>();

  for (const row of history) {
    highest = Math.max(highest, Number(row.arb_percentage));
    marketCounts.set(row.market_type, (marketCounts.get(row.market_type) ?? 0) + 1);
    activeGameMarketPoints.add(`${row.game_id}-${row.market_type}-${row.point ?? "ml"}`);

    const pairKey = [row.book_a, row.book_b].sort().join(" ↔ ");
    const pair = pairTotals.get(pairKey) ?? { sum: 0, count: 0 };
    pair.sum += Number(row.arb_percentage);
    pair.count += 1;
    pairTotals.set(pairKey, pair);
  }

  const mostCommonMarketType = [...marketCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const bestPair = [...pairTotals.entries()].sort((a, b) => b[1].sum / b[1].count - a[1].sum / a[1].count)[0][0];

  // "Still active" — of everything logged in the last 24h, how many
  // (game, market, point) groups are also present in the current live
  // detection pass (computed by the caller, at the same minArb threshold).
  let activeNow = 0;
  for (const key of activeGameMarketPoints) {
    if (activeIds.has(key)) activeNow++;
  }

  return {
    totalDetected24h: history.length,
    activeNow,
    highestArbPercentage24h: highest,
    mostCommonMarket: MARKET_LABELS[mostCommonMarketType] ?? mostCommonMarketType,
    mostProfitableBookPair: bestPair,
  };
}

// GET /api/arb?sport=mlb&market=h2h&minArb=1.0
// Live arb list is computed fresh from current odds on every request (same
// philosophy as CLV's live-computed currentPrice) — arbs close in seconds,
// so reading stale rows from arbitrage_opportunities would show hedges that
// no longer exist. That table only backs the 24h stats card here.
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const sportSlug = searchParams.get("sport");
    const marketType = searchParams.get("market") as MarketType | null;
    const minArbParam = searchParams.get("minArb");
    const minArb = minArbParam ? Number(minArbParam) : DEFAULT_MIN_ARB_PERCENTAGE;

    if (!Number.isFinite(minArb) || minArb < 0) {
      return NextResponse.json(emptyResponse("minArb must be a non-negative number"), { status: 400 });
    }

    let gamesQuery = supabase
      .from("games")
      .select("id, external_id, home_team, away_team, commence_time, status, sport_id, sports(slug)")
      .order("commence_time", { ascending: true });

    if (sportSlug) {
      const { data: sport, error: sportError } = await supabase.from("sports").select("id").eq("slug", sportSlug).single();
      if (sportError || !sport) {
        return NextResponse.json(emptyResponse(`Unknown sport: ${sportSlug}`), { status: 400 });
      }
      gamesQuery = gamesQuery.eq("sport_id", sport.id);
    }

    const { data: games, error: gamesError } = await gamesQuery;
    if (gamesError) throw new Error(`Failed to load games: ${gamesError.message}`);

    if (!games || games.length === 0) {
      return NextResponse.json(emptyResponse());
    }

    const gamesWithOdds = await getLatestGamesWithOdds(
      supabase,
      games.map((g) => ({ ...g, sports: g.sports as unknown as { slug: string } | null }))
    );

    let opportunities: ArbOpportunity[] = detectAllArbs(gamesWithOdds, minArb);
    if (marketType) opportunities = opportunities.filter((o) => o.marketType === marketType);

    const stats = await computeStats(supabase, new Set(opportunities.map((o) => o.id)));

    return NextResponse.json({
      arbitrageOpportunities: opportunities,
      totalArbsAvailable: opportunities.length,
      highestArbPercentage: opportunities.length > 0 ? opportunities[0].arbPercentage : null,
      stats,
    } satisfies ArbResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[arb] Failed:", message);
    return NextResponse.json(emptyResponse(message), { status: 500 });
  }
}
