"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MarketType } from "@/types/odds";
import type { SignalMode, SignalOpportunity, SignalsResponse } from "@/types/signals";
import type { SportFilter } from "./filters";

const REFRESH_INTERVAL_MS = 60_000;
const MIN_EV_FLOOR = 1;
const MIN_EV_CEIL = 15;
const DEFAULT_MIN_EV = 1;

type SortMode = "ev" | "kelly" | "soonest";

function logError(context: string, err: unknown) {
  console.error(`[SignalsTab ${new Date().toISOString()}] ${context}:`, err);
}

function formatPct(fraction: number, decimals = 2): string {
  return `${(fraction * 100).toFixed(decimals)}%`;
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function formatSettleTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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

function ModePill({ mode }: { mode: SignalMode }) {
  const isSimulated = mode === "SIMULATED";
  return (
    <span
      className={`text-[11px] font-mono font-semibold rounded px-2 py-0.5 border ${
        isSimulated ? "text-warning border-warning/40 bg-warning/10" : "text-accent border-accent/40 bg-accent/10"
      }`}
    >
      MODE: {mode}
    </span>
  );
}

function SimulatedBanner() {
  return (
    <div className="rounded-md bg-warning px-4 py-2.5 text-sm font-semibold text-[#1a1200] flex items-center gap-2">
      ⚠️ SIMULATED DATA — Pinnacle feed not connected. Signals are NOT tradeable. Do not execute real bets.
    </div>
  );
}

function ModelBreakdownTable({ opp }: { opp: SignalOpportunity }) {
  const books = Object.keys(opp.perModelBreakdown);
  const modelKeys = ["multiplicative", "additive", "power", "probit", "shin"] as const;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono border-collapse">
        <thead>
          <tr className="text-muted text-left">
            <th className="py-1 pr-3 font-normal">MODEL</th>
            {books.map((b) => (
              <th key={b} className="py-1 pr-3 font-normal">{b.toUpperCase()}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {modelKeys.map((model) => (
            <tr key={model} className="border-t border-border">
              <td className="py-1 pr-3 text-muted">{model}</td>
              {books.map((b) => {
                const value = opp.perModelBreakdown[b][model];
                const isWorstCase = Math.abs(value - opp.worstCaseUsed[b]) < 1e-9;
                return (
                  <td key={b} className={`py-1 pr-3 ${isWorstCase ? "text-accent font-semibold bg-accent/10 rounded" : "text-foreground"}`}>
                    {formatPct(value)}
                    {isWorstCase && <span className="text-[9px] ml-1 text-accent">USED</span>}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="border-t border-border">
            <td className="py-1 pr-3 text-muted font-semibold">consensus avg</td>
            <td colSpan={books.length} className="py-1 pr-3 text-foreground font-semibold">
              {formatPct(opp.consensusProb)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SignalCard({ opp, minEv, expanded, onToggleExpand }: { opp: SignalOpportunity; minEv: number; expanded: boolean; onToggleExpand: () => void }) {
  const meetsThreshold = opp.evPercent * 100 >= minEv;

  async function handleCopy() {
    const lines = [
      `+EV BUY ${opp.side.toUpperCase()} — ${opp.executionVenue.toUpperCase()}`,
      `${opp.awayTeam} @ ${opp.homeTeam} (${opp.sport})`,
      `Outcome: ${opp.outcomeName}`,
      `Consensus Prob: ${formatPct(opp.consensusProb)} | Offered Price: ${opp.offeredPrice.toFixed(4)}`,
      `EV: ${formatPct(opp.evPercent)} | Kelly Stake: ${formatUsd(opp.kellyStakeDollars)}`,
      `Expected Profit: ${formatUsd(opp.expectedProfit)} | Projected IRR: ${formatPct(opp.projectedIrr)} (illustrative)`,
      opp.isSimulated ? "SIMULATED — NOT FOR EXECUTION" : "",
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
    } catch (err) {
      logError("clipboard write failed", err);
    }
  }

  return (
    <div
      className={`rounded-lg border bg-surface p-4 flex flex-col gap-3 fade-in-row ${
        meetsThreshold ? "border-border border-l-2 border-l-accent" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium flex items-center gap-1.5">
            {opp.isUrgent && <span className="text-warning" title="Settling within 48 hours">●</span>}
            {opp.awayTeam} <span className="text-muted">@</span> {opp.homeTeam}
          </div>
          <div className="text-xs text-muted">{opp.sport} · settles {formatSettleTime(opp.expiresAt ?? "")}</div>
        </div>
      </div>

      <div className="text-sm font-semibold text-foreground">
        +EV BUY {opp.side.toUpperCase()} — {opp.executionVenue.toUpperCase()}
        <span className="text-xs font-normal text-muted"> ({opp.outcomeName})</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-md border border-border bg-background px-3 py-2 flex flex-col gap-0.5">
          <div className="text-[11px] text-muted">CONSENSUS PROB</div>
          <div className="text-sm font-mono font-semibold text-foreground">{formatPct(opp.consensusProb)}</div>
        </div>
        <div className="rounded-md border border-border bg-background px-3 py-2 flex flex-col gap-0.5">
          <div className="text-[11px] text-muted">OFFERED PRICE</div>
          <div className="text-sm font-mono font-semibold text-foreground">{opp.offeredPrice.toFixed(4)}</div>
        </div>
        <div className="rounded-md border border-border bg-background px-3 py-2 flex flex-col gap-0.5">
          <div className="text-[11px] text-muted">EV%</div>
          <div className={`text-sm font-mono font-semibold ${meetsThreshold ? "text-accent" : "text-foreground"}`}>{formatPct(opp.evPercent)}</div>
        </div>
        <div className="rounded-md border border-border bg-background px-3 py-2 flex flex-col gap-0.5">
          <div className="text-[11px] text-muted">KELLY STAKE</div>
          <div className="text-sm font-mono font-semibold text-foreground">
            {formatUsd(opp.kellyStakeDollars)} <span className="text-[10px] text-muted">({formatPct(opp.kellyStakeDollars / 10000, 1)})</span>
          </div>
        </div>
      </div>

      <div className="flex gap-4 text-xs font-mono">
        <div>
          <span className="text-muted">Expected Profit: </span>
          <span className="text-foreground">{formatUsd(opp.expectedProfit)}</span>
        </div>
        <div title="Illustrative annualized projection, not a guarantee">
          <span className="text-muted">Projected IRR: </span>
          <span className="text-foreground">{formatPct(opp.projectedIrr)}</span>
        </div>
      </div>

      {expanded && (
        <div className="rounded-md border border-border bg-background p-3">
          <ModelBreakdownTable opp={opp} />
        </div>
      )}

      <div className="flex gap-2">
        <button
          disabled
          title="Execution locked until live Pinnacle feed is connected"
          className="flex-1 rounded-md border border-border text-xs font-semibold py-2 text-muted cursor-not-allowed opacity-50"
        >
          EXECUTE
        </button>
        <button
          onClick={handleCopy}
          className="flex-1 rounded-md border border-border text-xs font-medium py-2 text-foreground hover:border-accent transition-colors"
        >
          COPY
        </button>
        <button
          onClick={onToggleExpand}
          className="flex-1 rounded-md border border-border text-xs font-medium py-2 text-foreground hover:border-accent transition-colors"
        >
          {expanded ? "HIDE DETAILS" : "DETAILS"}
        </button>
      </div>
    </div>
  );
}

// SIGNALS — a second, LAF-native +EV detection engine, fully independent
// from quant_engine (surfaced separately in the QUANT tab). Synthesizes its
// "sharp" baseline from Action Network odds LAF already scrapes (see
// lib/adapters/pinnacleAdapter.ts) rather than ingesting real Kalshi/
// Polymarket data itself. See README.md's SIGNALS section for the
// simulated/live mode explanation and the mock-baseline circularity caveat.
export function SignalsTab({}: {
  sport: SportFilter;
  market: MarketType;
  onSportChange: (sport: SportFilter) => void;
  onMarketChange: (market: MarketType) => void;
}) {
  const [data, setData] = useState<SignalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [minEv, setMinEv] = useState(DEFAULT_MIN_EV);
  const [sortMode, setSortMode] = useState<SortMode>("ev");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const fetchSignals = useCallback(async () => {
    setSpinning(true);
    setError(null);
    try {
      const res = await fetch("/api/signals");
      const json: SignalsResponse = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load signals");
      setData(json);
    } catch (err) {
      logError("fetchSignals failed", err);
      setError("SIGNALS detection temporarily unavailable. Retrying...");
    } finally {
      setLoading(false);
      setSpinning(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(fetchSignals, 0);
    return () => clearTimeout(timeoutId);
  }, [fetchSignals]);

  // Auto-refresh every minute while visible, same pattern as every other tab.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalId) return;
      intervalId = setInterval(fetchSignals, REFRESH_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchSignals();
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
  }, [fetchSignals]);

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const displayedOpps = useMemo(() => {
    const all = data?.opportunities ?? [];
    const filtered = all.filter((o) => o.evPercent * 100 >= minEv);
    const sorted = [...filtered];
    if (sortMode === "ev") sorted.sort((a, b) => b.evPercent - a.evPercent);
    else if (sortMode === "kelly") sorted.sort((a, b) => b.kellyStakeDollars - a.kellyStakeDollars);
    else if (sortMode === "soonest") sorted.sort((a, b) => new Date(a.expiresAt ?? 0).getTime() - new Date(b.expiresAt ?? 0).getTime());
    return sorted;
  }, [data, minEv, sortMode]);

  const mode: SignalMode = data?.mode ?? "SIMULATED";

  return (
    <div className="flex flex-col gap-4">
      {mode === "SIMULATED" && <SimulatedBanner />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">SIGNALS</h2>
          <ModePill mode={mode} />
          <div className="flex items-center gap-2 text-xs font-mono text-muted">
            <span>Min EV ≥</span>
            <span className="text-accent w-10">{minEv}%</span>
            <input
              type="range"
              min={MIN_EV_FLOOR}
              max={MIN_EV_CEIL}
              step={0.5}
              value={minEv}
              onChange={(e) => setMinEv(Number(e.target.value))}
              className="w-32 accent-[#22c55e]"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-muted">
          <span>Sort:</span>
          {(["ev", "kelly", "soonest"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortMode(s)}
              className={`px-2 py-1 rounded border transition-colors ${
                sortMode === s ? "border-accent text-accent bg-accent/10" : "border-border text-muted hover:text-foreground"
              }`}
            >
              {s === "ev" ? "EV%" : s === "kelly" ? "KELLY $" : "SOONEST"}
            </button>
          ))}
          <span className="flex items-center gap-1.5 ml-2">
            <RefreshIcon spinning={spinning} />
            Auto-refreshing every 1 min
          </span>
        </div>
      </div>

      {error && <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

      {loading && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="skeleton rounded-lg h-48 w-full" />
          ))}
        </div>
      )}

      {!loading && !error && displayedOpps.length === 0 && (
        <div className="rounded-md border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
          No opportunities above {minEv}% right now.
        </div>
      )}

      {!loading && displayedOpps.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {displayedOpps.map((opp) => (
            <SignalCard key={opp.id} opp={opp} minEv={minEv} expanded={expandedIds.has(opp.id)} onToggleExpand={() => toggleExpand(opp.id)} />
          ))}
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface p-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Arbitrage</div>
          <div className="text-xs text-muted">True guaranteed-profit hedges across every book — see the ARB tab.</div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4 opacity-50">
        <div className="text-sm font-semibold">Statistical Middles (coming soon)</div>
      </div>
    </div>
  );
}
