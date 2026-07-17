import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isSimulatedMode } from "@/lib/adapters/pinnacleAdapter";
import type { ExecuteSignalRequest, ExecuteSignalResponse } from "@/types/signals";

// POST /api/signals/execute — the "semi-automated" step: logs a chosen
// opportunity into signal_trades as an open position with the stake the
// user confirmed. Actual order placement on the venue itself remains manual
// for now; this only records intent + sizing.
//
// HARD LOCKED while PINNACLE_SOURCE !== 'odds_api'. Since
// OddsApiPinnacleAdapter is a stub-only TODO (see lib/adapters/pinnacleAdapter.ts),
// this route is unconditionally rejected until both a paid Odds API key is
// added AND that adapter is finished — consistent with this session's
// established paper-trading-only precedent for quant_engine, enforced here
// through the mode flag instead of a separate policy.
export async function POST(request: NextRequest) {
  if (isSimulatedMode()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Execution is locked: SIGNALS is running in SIMULATED mode (PINNACLE_SOURCE is not 'odds_api'). " +
          "Simulated opportunities are derived from LAF's own already-scraped sportsbook odds, not a real " +
          "Pinnacle feed, and are not tradeable. See README.md for how to go live.",
      } satisfies ExecuteSignalResponse,
      { status: 403 }
    );
  }

  let body: ExecuteSignalRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" } satisfies ExecuteSignalResponse, { status: 400 });
  }

  if (!body.opportunityId || typeof body.opportunityId !== "number") {
    return NextResponse.json({ success: false, error: "opportunityId is required" } satisfies ExecuteSignalResponse, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: opp, error: oppError } = await supabase
      .from("signal_opportunities")
      .select("*")
      .eq("id", body.opportunityId)
      .single();
    if (oppError || !opp) {
      return NextResponse.json({ success: false, error: `Opportunity ${body.opportunityId} not found` } satisfies ExecuteSignalResponse, {
        status: 404,
      });
    }

    const stake = body.stakeOverride && body.stakeOverride > 0 ? body.stakeOverride : Number(opp.kelly_stake);

    const { data: trade, error: tradeError } = await supabase
      .from("signal_trades")
      .insert({
        opportunity_id: opp.id,
        canonical_id: opp.canonical_id,
        execution_venue: opp.execution_venue,
        side: opp.side,
        entry_price: opp.offered_price,
        stake,
        consensus_prob: opp.consensus_prob,
        ev_at_entry: opp.ev_percent,
        status: "open",
        is_simulated: false,
      })
      .select("*")
      .single();
    if (tradeError || !trade) throw new Error(tradeError?.message ?? "Insert failed");

    return NextResponse.json({
      success: true,
      trade: {
        id: trade.id,
        opportunityId: trade.opportunity_id,
        canonicalId: trade.canonical_id,
        executionVenue: trade.execution_venue,
        side: trade.side,
        entryPrice: Number(trade.entry_price),
        stake: Number(trade.stake),
        consensusProb: Number(trade.consensus_prob),
        evAtEntry: Number(trade.ev_at_entry),
        status: trade.status,
        closingProb: trade.closing_prob !== null ? Number(trade.closing_prob) : null,
        clvPercent: trade.clv_percent !== null ? Number(trade.clv_percent) : null,
        isSimulated: trade.is_simulated,
        executedAt: trade.executed_at,
        settledAt: trade.settled_at,
      },
    } satisfies ExecuteSignalResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[signals/execute] Failed:", message);
    return NextResponse.json({ success: false, error: message } satisfies ExecuteSignalResponse, { status: 500 });
  }
}
