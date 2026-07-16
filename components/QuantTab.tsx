"use client";

import { useCallback, useEffect, useState } from "react";
import type { MarketType } from "@/types/odds";
import type { QuantPaperTrade, QuantResponse, QuantTradeStatus } from "@/types/quant";
import { FilterButton, type SportFilter } from "./filters";

const REFRESH_INTERVAL_MS = 60_000;
const STATUS_FILTERS: { value: QuantTradeStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "ALL" },
  { value: "PENDING", label: "PENDING" },
  { value: "WON", label: "WON" },
  { value: "LOST", label: "LOST" },
  { value: "VOID", label: "VOID" },
  { value: "EXECUTED", label: "EXECUTED" },
];

function logError(context: string, err: unknown) {
  console.error(`[QuantTab ${new Date().toISOString()}] ${context}:`, err);
}

function formatPct(fraction: number): string {
  return `${(fraction * 100).toFixed(2)}%`;
}

function formatUsd(amount: number): string {
  return `${amount < 0 ? "-" : ""}$${Math.abs(amount).toFixed(2)}`;
}

function formatRelativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function statusColorClass(status: QuantTradeStatus): string {
  if (status === "WON") return "text-accent border-accent/40 bg-accent/10";
  if (status === "LOST") return "text-danger border-danger/40 bg-danger/10";
  return "text-muted border-border bg-background";
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`w-3 h-3 ${spinning ? "animate-spin" : ""}`}>
      <path
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BankrollCard({ bankroll, startingFallback }: { bankroll: QuantResponse["bankroll"]; startingFallback: number }) {
  if (!bankroll) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
        No bankroll snapshots yet — quant_engine records one on its first daily-summary cycle.
      </div>
    );
  }

  const totalPnl = bankroll.currentBalance - bankroll.startingBalance;
  const roi = bankroll.startingBalance > 0 ? totalPnl / bankroll.startingBalance : 0;
  const pnlClass = totalPnl >= 0 ? "text-accent" : "text-danger";

  const rows: { label: string; value: string; className?: string }[] = [
    { label: "Current Balance", value: formatUsd(bankroll.currentBalance) },
    { label: "Starting Capital", value: formatUsd(bankroll.startingBalance || startingFallback) },
    { label: "Realized P&L", value: formatUsd(bankroll.realizedPnl) },
    { label: "Unrealized P&L", value: formatUsd(bankroll.unrealizedPnl) },
    { label: "Total P&L", value: formatUsd(totalPnl), className: pnlClass },
    { label: "ROI", value: formatPct(roi), className: pnlClass },
  ];

  return (
    <div className="rounded-lg border border-border bg-surface p-4 flex flex-col gap-2">
      <div className="text-sm font-semibold mb-1">BANKROLL</div>
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between text-xs">
          <span className="text-muted">{r.label}</span>
          <span className={`font-mono ${r.className ?? "text-foreground"}`}>{r.value}</span>
        </div>
      ))}
      <div className="text-[11px] text-muted mt-1">
        As of {new Date(bankroll.timestamp).toLocaleString()}
      </div>
    </div>
  );
}

function TradeRow({ trade }: { trade: QuantPaperTrade }) {
  const matchup = trade.marketDetails.matchup ?? trade.canonicalId;
  const source = trade.marketDetails.source ? trade.marketDetails.source.toUpperCase() : null;

  return (
    <div className="rounded-lg border border-border bg-surface p-4 flex flex-col gap-2 fade-in-row">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{matchup}</div>
          <div className="text-xs text-muted">
            {trade.strategyType === "PLUS_EV" ? "+EV" : "MIDDLE"}
            {source ? ` · ${source}` : ""}
            {trade.marketDetails.team ? ` · ${trade.marketDetails.team}` : ""}
          </div>
        </div>
        <span className={`text-[11px] font-mono border rounded px-2 py-0.5 ${statusColorClass(trade.status)}`}>{trade.status}</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-md border border-border bg-background px-3 py-2 flex flex-col gap-0.5">
          <div className="text-[11px] text-muted">EV</div>
          <div className="text-sm font-mono font-semibold text-accent">{formatPct(trade.calculatedEv)}</div>
        </div>
        <div className="rounded-md border border-border bg-background px-3 py-2 flex flex-col gap-0.5">
          <div className="text-[11px] text-muted">Kelly Stake</div>
          <div className="text-sm font-mono font-semibold text-foreground">{formatUsd(trade.suggestedStake)}</div>
        </div>
        <div className="rounded-md border border-border bg-background px-3 py-2 flex flex-col gap-0.5">
          <div className="text-[11px] text-muted">Target Price</div>
          <div className="text-sm font-mono text-foreground">{trade.targetPrice.toFixed(3)}</div>
        </div>
        <div className="rounded-md border border-border bg-background px-3 py-2 flex flex-col gap-0.5">
          <div className="text-[11px] text-muted">Consensus Prob</div>
          <div className="text-sm font-mono text-foreground">{formatPct(trade.consensusProb)}</div>
        </div>
      </div>

      {trade.status !== "PENDING" && trade.actualProfitLoss !== null && (
        <div className="text-xs font-mono">
          <span className="text-muted">P&amp;L: </span>
          <span className={trade.actualProfitLoss >= 0 ? "text-accent" : "text-danger"}>{formatUsd(trade.actualProfitLoss)}</span>
        </div>
      )}

      <div className="text-[11px] text-muted">{formatRelativeTime(trade.timestamp)}</div>
    </div>
  );
}

// Read-only view into quant_engine's paper-trading data (separate Python
// repo — see quant_engine/README.md). Accepts the same 4-prop signature
// every tab gets from page.tsx for consistency, but ignores sport/market:
// quant_engine's sport lives inside marketDetails JSON, not a filterable
// column, and "market" (h2h/spreads/totals) has no meaning for a paper-trade
// log. Filters instead by trade status, which the API supports server-side.
export function QuantTab(props: {
  sport: SportFilter;
  market: MarketType;
  onSportChange: (sport: SportFilter) => void;
  onMarketChange: (market: MarketType) => void;
}) {
  void props; // accepted for the uniform 4-prop signature every tab gets from page.tsx, deliberately unused (see comment above)
  const [data, setData] = useState<QuantResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [statusFilter, setStatusFilter] = useState<QuantTradeStatus | "ALL">("ALL");

  const fetchQuant = useCallback(async () => {
    setSpinning(true);
    setError(null);
    try {
      const res = await fetch(`/api/quant?status=${statusFilter}`);
      const json: QuantResponse = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load quant_engine data");
      setData(json);
    } catch (err) {
      logError("fetchQuant failed", err);
      setError("quant_engine data temporarily unavailable. Retrying...");
    } finally {
      setLoading(false);
      setSpinning(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    const timeoutId = setTimeout(fetchQuant, 0);
    return () => clearTimeout(timeoutId);
  }, [fetchQuant]);

  // Auto-refresh every minute while visible, same pattern as ARB/STEAM/CLV tabs.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalId) return;
      intervalId = setInterval(fetchQuant, REFRESH_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchQuant();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchQuant]);

  const trades = data?.trades ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">PAPER TRADES</h2>
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((s) => (
              <FilterButton key={s.value} active={statusFilter === s.value} onClick={() => setStatusFilter(s.value)}>
                {s.label}
              </FilterButton>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-mono text-muted">
          <RefreshIcon spinning={spinning} />
          Auto-refreshing every 1 min
        </div>
      </div>

      <BankrollCard bankroll={data?.bankroll ?? null} startingFallback={10000} />

      {error && <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

      {loading && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="skeleton rounded-lg h-32 w-full" />
          ))}
        </div>
      )}

      {!loading && !error && trades.length === 0 && (
        <div className="rounded-md border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
          No paper trades logged yet. This is expected until quant_engine has a real ODDS_API_KEY configured —
          see quant_engine/README.md.
        </div>
      )}

      {!loading && trades.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {trades.map((t) => (
            <TradeRow key={t.id} trade={t} />
          ))}
        </div>
      )}
    </div>
  );
}
