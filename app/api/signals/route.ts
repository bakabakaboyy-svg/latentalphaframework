import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isSimulatedMode } from "@/lib/adapters/pinnacleAdapter";
import { prioritizeUrgent } from "@/lib/signals/velocity";
import { projectedIrr } from "@/lib/signals/sizing";
import type { SignalOpportunity, SignalPerBookBreakdown, SignalsResponse } from "@/types/signals";

// Detection runs on the real 5-minute GitHub Actions scrape cycle (see
// lib/runScrape.ts) — this only needs to read back whatever the most recent
// cycle already computed and stored, not recompute live on every page load
// the way ARB's cards do (de-vigging + multiple Supabase round-trips per
// market is a meaningfully heavier computation than ARB's single-pass
// implied-probability math).
const RECENT_WINDOW_MINUTES = 10;

function emptyResponse(error?: string): SignalsResponse {
  return { mode: isSimulatedMode() ? "SIMULATED" : "LIVE", opportunities: [], error };
}

// GET /api/signals — no sport/market filtering server-side; SIGNALS is
// already scoped to WNBA/MLB h2h only (see lib/migrations/007_signals.sql),
// and the tab's own EV slider + sort control filter client-side, matching
// ARB tab's own threshold-slider pattern.
export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const cutoff = new Date(Date.now() - RECENT_WINDOW_MINUTES * 60 * 1000).toISOString();

    const { data: rows, error } = await supabase
      .from("signal_opportunities")
      .select("*, games(home_team, away_team)")
      .gte("detected_at", cutoff)
      .order("ev_percent", { ascending: false });

    if (error) throw new Error(`Failed to load signal_opportunities: ${error.message}`);

    const now = new Date();
    const opportunities: SignalOpportunity[] = (rows ?? []).map((row) => {
      const game = row.games as unknown as { home_team: string; away_team: string } | null;
      const breakdown = row.per_model_breakdown as SignalPerBookBreakdown;
      const evPercentValue = Number(row.ev_percent);

      // worstCaseUsed isn't its own column — it's cheaply derivable from the
      // stored breakdown. detect.ts always complements 'no'-side rows before
      // storing (see detect.ts's `complement()`), so every stored value,
      // regardless of side, already represents "probability of this row's
      // own outcome" — meaning the worst-case value used is uniformly the
      // MIN of the 5 stored per-model values for every row, not
      // side-dependent at read time.
      const worstCaseUsed: Record<string, number> = {};
      for (const [book, models] of Object.entries(breakdown)) {
        worstCaseUsed[book] = Math.min(...Object.values(models));
      }

      return {
        id: row.id,
        gameId: row.game_id,
        canonicalId: row.canonical_id,
        sport: row.sport,
        marketType: row.market_type,
        homeTeam: game?.home_team ?? "Unknown",
        awayTeam: game?.away_team ?? "Unknown",
        outcomeName: row.outcome_name,
        side: row.side,
        executionVenue: row.execution_venue,
        offeredPrice: Number(row.offered_price),
        consensusProb: Number(row.consensus_prob),
        perModelBreakdown: breakdown,
        worstCaseUsed,
        evPercent: evPercentValue,
        kellyStakeDollars: Number(row.kelly_stake),
        expectedProfit: row.expected_profit !== null ? Number(row.expected_profit) : 0,
        projectedIrr: projectedIrr(evPercentValue),
        isSimulated: row.is_simulated,
        detectedAt: row.detected_at,
        expiresAt: row.expires_at,
        isUrgent: row.expires_at ? prioritizeUrgent(row.expires_at, now) : false,
      };
    });

    return NextResponse.json({ mode: isSimulatedMode() ? "SIMULATED" : "LIVE", opportunities } satisfies SignalsResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[signals] Failed:", message);
    return NextResponse.json(emptyResponse(message), { status: 500 });
  }
}
