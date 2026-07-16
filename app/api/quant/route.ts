import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { QuantBankroll, QuantMarketDetails, QuantPaperTrade, QuantResponse, QuantTradeStatus } from "@/types/quant";

const VALID_STATUSES: QuantTradeStatus[] = ["PENDING", "WON", "LOST", "VOID", "EXECUTED"];
const TRADES_LIMIT = 200;

function emptyResponse(error?: string): QuantResponse {
  return { bankroll: null, trades: [], error };
}

// PostgREST returns DECIMAL/numeric columns as JSON strings (to avoid float
// precision loss) — every numeric column read from qe_* tables must be
// explicitly Number()-coerced or the QUANT tab gets strings where it expects
// numbers.
function toBankroll(row: Record<string, unknown>): QuantBankroll {
  return {
    timestamp: row.timestamp as string,
    startingBalance: Number(row.starting_balance),
    currentBalance: Number(row.current_balance),
    realizedPnl: Number(row.realized_pnl),
    unrealizedPnl: Number(row.unrealized_pnl),
    largestWin: row.largest_win !== null ? Number(row.largest_win) : null,
    largestLoss: row.largest_loss !== null ? Number(row.largest_loss) : null,
  };
}

function toPaperTrade(row: Record<string, unknown>): QuantPaperTrade {
  return {
    id: row.id as number,
    timestamp: row.timestamp as string,
    canonicalId: row.canonical_id as string,
    strategyType: row.strategy_type as QuantPaperTrade["strategyType"],
    marketDetails: (row.market_details as QuantMarketDetails) ?? {},
    targetPrice: Number(row.target_price),
    consensusProb: Number(row.consensus_prob),
    calculatedEv: Number(row.calculated_ev),
    suggestedStake: Number(row.suggested_stake),
    status: row.status as QuantTradeStatus,
    settlementDate: (row.settlement_date as string | null) ?? null,
    actualProfitLoss: row.actual_profit_loss !== null && row.actual_profit_loss !== undefined ? Number(row.actual_profit_loss) : null,
    notes: (row.notes as string | null) ?? null,
  };
}

// GET /api/quant?status=PENDING
// Read-only view into quant_engine's paper-trading data (separate Python
// repo, writes qe_* tables directly — see lib/migrations/006_quant_engine.sql).
// An empty/near-empty result here is expected, not a bug: quant_engine only
// logs real trades once it has a real ODDS_API_KEY configured, and only
// records a bankroll snapshot on its first daily-summary cycle.
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status");

    if (statusParam && statusParam !== "ALL" && !VALID_STATUSES.includes(statusParam as QuantTradeStatus)) {
      return NextResponse.json(emptyResponse(`Invalid status: ${statusParam}`), { status: 400 });
    }

    const { data: bankrollRows, error: bankrollError } = await supabase
      .from("qe_bankroll_history")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(1);
    if (bankrollError) throw new Error(`Failed to load qe_bankroll_history: ${bankrollError.message}`);

    let tradesQuery = supabase.from("qe_paper_trades").select("*").order("timestamp", { ascending: false }).limit(TRADES_LIMIT);
    if (statusParam && statusParam !== "ALL") {
      tradesQuery = tradesQuery.eq("status", statusParam);
    }
    const { data: tradeRows, error: tradesError } = await tradesQuery;
    if (tradesError) throw new Error(`Failed to load qe_paper_trades: ${tradesError.message}`);

    return NextResponse.json({
      bankroll: bankrollRows && bankrollRows.length > 0 ? toBankroll(bankrollRows[0]) : null,
      trades: (tradeRows ?? []).map(toPaperTrade),
    } satisfies QuantResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[quant] Failed:", message);
    return NextResponse.json(emptyResponse(message), { status: 500 });
  }
}
