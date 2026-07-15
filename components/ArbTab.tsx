"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ArbOpportunity, ArbResponse, MarketType } from "@/types/odds";
import { SportMarketFilters, type SportFilter } from "./filters";
import { useToasts, ToastContainer, type ToastVariant } from "./Toast";

const MARKET_LABELS: Record<MarketType, string> = { h2h: "MONEYLINE", spreads: "SPREAD", totals: "TOTAL" };
const REFRESH_INTERVAL_MS = 60_000;
const DEFAULT_THRESHOLD = 1;
const REFERENCE_STAKE = 100; // "Guaranteed profit with $100 bet" — the dollar amounts shown are for this reference total

function logError(context: string, err: unknown) {
  console.error(`[ArbTab ${new Date().toISOString()}] ${context}:`, err);
}

function formatPrice(price: number): string {
  return price > 0 ? `+${price}` : `${price}`;
}

function formatOutcome(outcomeName: string, marketType: MarketType, point: number | null): string {
  if (marketType === "h2h" || point === null) return outcomeName;
  return `${outcomeName} ${point > 0 ? "+" : ""}${point}`;
}

function formatRelativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
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

function ArbCard({
  opp,
  firstSeenAt,
  onLogHedge,
  showToast,
}: {
  opp: ArbOpportunity;
  firstSeenAt: string;
  onLogHedge: (opp: ArbOpportunity) => void;
  showToast: (message: string, variant?: ToastVariant) => void;
}) {
  async function handleCopy() {
    const lines = [
      `ARBITRAGE: ${opp.awayTeam} @ ${opp.homeTeam} (${MARKET_LABELS[opp.marketType]})`,
      ...opp.legs.map(
        (leg) => `Bet $${(leg.betSplit * REFERENCE_STAKE).toFixed(2)} on ${formatOutcome(leg.outcomeName, opp.marketType, opp.point)} ${formatPrice(leg.odds)} at ${leg.bookName}`
      ),
      `Guaranteed profit: ${opp.arbPercentage.toFixed(2)}%`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      showToast("Copied bet instructions to clipboard.", "success");
    } catch (err) {
      logError("clipboard write failed", err);
      showToast("Couldn't copy to clipboard.", "error");
    }
  }

  return (
    <div
      className="rounded-lg border border-border border-l-2 border-l-accent bg-surface p-4 flex flex-col gap-3 fade-in-row"
      title="Click to see more details about this opportunity"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">
            {opp.awayTeam} <span className="text-muted">@</span> {opp.homeTeam}
          </div>
          <div className="text-xs text-muted">{MARKET_LABELS[opp.marketType]}</div>
        </div>
        <span className="text-[11px] font-mono text-accent border border-accent/40 bg-accent/10 rounded px-2 py-0.5">ACTIVE</span>
      </div>

      <div className={`grid gap-2 ${opp.legs.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {opp.legs.map((leg, i) => (
          <div key={i} className="rounded-md border border-border bg-background px-3 py-2 flex flex-col gap-0.5">
            <div className="text-xs text-foreground truncate">{formatOutcome(leg.outcomeName, opp.marketType, opp.point)}</div>
            <div className="text-lg font-mono font-semibold text-foreground">{formatPrice(leg.odds)}</div>
            <div className="text-[11px] text-muted">{leg.bookName}</div>
            <div className="text-[11px] font-mono text-muted">{(leg.impliedProb * 100).toFixed(2)}% implied</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <div className="text-2xl font-mono font-bold text-accent">{opp.arbPercentage.toFixed(2)}% ARBITRAGE</div>
        <div className="text-xs text-muted">Guaranteed profit with $100 bet</div>
        <div className="text-xs font-mono text-foreground">
          {opp.legs
            .map((leg) => `Bet $${(leg.betSplit * REFERENCE_STAKE).toFixed(2)} on ${formatOutcome(leg.outcomeName, opp.marketType, opp.point)}`)
            .join(", ")}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleCopy}
          className="flex-1 rounded-md border border-border text-xs font-medium py-2 text-foreground hover:border-accent transition-colors"
        >
          COPY TO CLIPBOARD
        </button>
        <button
          onClick={() => onLogHedge(opp)}
          className="flex-1 rounded-md bg-accent text-background text-xs font-semibold py-2 hover:opacity-90 transition-opacity"
        >
          LOG AS HEDGE
        </button>
      </div>

      <div className="text-[11px] text-muted">Detected {formatRelativeTime(firstSeenAt)}</div>
    </div>
  );
}

function LogHedgeModal({
  opp,
  onClose,
  showToast,
}: {
  opp: ArbOpportunity;
  onClose: () => void;
  showToast: (message: string, variant?: ToastVariant) => void;
}) {
  const [totalStake, setTotalStake] = useState(String(REFERENCE_STAKE));
  const [submitting, setSubmitting] = useState(false);
  const stakeNum = Number(totalStake);
  const validStake = totalStake !== "" && Number.isFinite(stakeNum) && stakeNum > 0;

  async function handleConfirm() {
    if (!validStake) return;
    setSubmitting(true);
    try {
      const results = await Promise.all(
        opp.legs.map((leg) =>
          fetch("/api/clv", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              gameId: opp.gameId,
              marketType: opp.marketType,
              outcomeName: leg.outcomeName,
              point: opp.point,
              bookSlug: leg.bookSlug,
              entryPrice: leg.odds,
              stake: Number((leg.betSplit * stakeNum).toFixed(2)),
              entryTime: new Date().toISOString(),
            }),
          }).then((res) => res.json())
        )
      );
      const failed = results.find((r) => !r.success);
      if (failed) throw new Error(failed.error ?? "Failed to log one or more legs");
      showToast(`Hedge logged — ${opp.legs.length} bets added to CLV tab.`, "success");
      onClose();
    } catch (err) {
      logError("log hedge failed", err);
      showToast(err instanceof Error ? err.message : "Failed to log hedge", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-surface p-5 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-semibold">Log hedge — both legs to CLV</div>
        <div className="text-xs text-muted">
          {opp.awayTeam} @ {opp.homeTeam} · {MARKET_LABELS[opp.marketType]}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Total stake</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={totalStake}
            onChange={(e) => setTotalStake(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-accent"
          />
        </div>

        <div className="flex flex-col gap-1.5 text-xs font-mono">
          {opp.legs.map((leg, i) => (
            <div key={i} className="flex justify-between text-foreground">
              <span className="truncate pr-2">
                {formatOutcome(leg.outcomeName, opp.marketType, opp.point)} {formatPrice(leg.odds)} @ {leg.bookName}
              </span>
              <span className="text-muted whitespace-nowrap">
                ${validStake ? (leg.betSplit * stakeNum).toFixed(2) : "—"}
              </span>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-md border border-border text-xs font-medium py-2 text-muted hover:text-foreground transition-colors"
          >
            CANCEL
          </button>
          <button
            onClick={handleConfirm}
            disabled={!validStake || submitting}
            className="flex-1 rounded-md bg-accent text-background text-xs font-semibold py-2 hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitting ? "LOGGING..." : "CONFIRM"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ArbTab({
  sport,
  market,
  onSportChange,
  onMarketChange,
}: {
  sport: SportFilter;
  market: MarketType;
  onSportChange: (sport: SportFilter) => void;
  onMarketChange: (market: MarketType) => void;
}) {
  const { toasts, showToast } = useToasts();
  const [data, setData] = useState<ArbResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [hedgeOpp, setHedgeOpp] = useState<ArbOpportunity | null>(null);
  const [statsExpanded, setStatsExpanded] = useState(false);

  // First-observed timestamp per arb id, client-side — the API recomputes
  // arbs fresh on every request (so its own detectedAt is always ~now), so
  // "Detected X minutes ago" is tracked here instead, based on how long this
  // browser session has continuously seen the same opportunity. State (not a
  // ref) because it's read during render.
  const [firstSeenById, setFirstSeenById] = useState<Map<string, string>>(new Map());
  const prevIds = useRef<Set<string> | null>(null);

  const fetchArbs = useCallback(async () => {
    setSpinning(true);
    setError(null);
    try {
      // Always fetch with no server-side threshold — the slider filters
      // client-side for instant, real-time response instead of a network
      // round-trip per tick.
      const params = new URLSearchParams({ market, minArb: "0" });
      if (sport !== "all") params.set("sport", sport);
      const res = await fetch(`/api/arb?${params.toString()}`);
      const json: ArbResponse = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load arbitrage opportunities");

      const now = new Date().toISOString();
      const newIds = new Set(json.arbitrageOpportunities.map((o) => o.id));
      if (prevIds.current) {
        for (const id of prevIds.current) {
          if (!newIds.has(id)) showToast("This arb has closed.", "warning");
        }
      }
      prevIds.current = newIds;

      setFirstSeenById((prev) => {
        const next = new Map<string, string>();
        for (const id of newIds) next.set(id, prev.get(id) ?? now);
        return next;
      });
      setData(json);
    } catch (err) {
      logError("fetchArbs failed", err);
      setError("Arb detection temporarily unavailable. Retrying...");
    } finally {
      setLoading(false);
      setSpinning(false);
    }
  }, [sport, market, showToast]);

  useEffect(() => {
    const timeoutId = setTimeout(fetchArbs, 0);
    return () => clearTimeout(timeoutId);
  }, [fetchArbs]);

  // Auto-refresh every minute while visible, same pattern as STEAM/CLV tabs.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalId) return;
      intervalId = setInterval(fetchArbs, REFRESH_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchArbs();
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
  }, [fetchArbs]);

  const allOpps = data?.arbitrageOpportunities ?? [];
  const displayedOpps = allOpps.filter((o) => o.arbPercentage >= threshold);
  const stats = data?.stats;

  return (
    <div className="flex flex-col gap-4">
      <ToastContainer toasts={toasts} />
      {hedgeOpp && <LogHedgeModal opp={hedgeOpp} onClose={() => setHedgeOpp(null)} showToast={showToast} />}

      <SportMarketFilters sport={sport} market={market} onSportChange={onSportChange} onMarketChange={onMarketChange} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">LIVE ARBS</h2>
          <div className="flex items-center gap-2 text-xs font-mono text-muted">
            <span>Show arbs ≥</span>
            <span className="text-accent w-10">{threshold.toFixed(1)}%</span>
            <input
              type="range"
              min={0}
              max={5}
              step={0.1}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-32 accent-[#22c55e]"
            />
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-mono text-muted">
          <RefreshIcon spinning={spinning} />
          Auto-refreshing every 1 min
        </div>
      </div>

      {error && <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

      {loading && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="skeleton rounded-lg h-40 w-full" />
          ))}
        </div>
      )}

      {!loading && !error && displayedOpps.length === 0 && (
        <div className="rounded-md border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
          No arbitrage opportunities detected at current threshold. Lower threshold or check back soon.
        </div>
      )}

      {!loading && displayedOpps.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {displayedOpps.map((opp) => (
            <ArbCard
              key={opp.id}
              opp={opp}
              firstSeenAt={firstSeenById.get(opp.id) ?? opp.detectedAt}
              onLogHedge={setHedgeOpp}
              showToast={showToast}
            />
          ))}
        </div>
      )}

      {stats && (
        <div className="rounded-lg border border-border bg-surface">
          <button
            onClick={() => setStatsExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold"
          >
            Arbitrage Activity (Last 24 Hours)
            <span className="text-muted text-xs">{statsExpanded ? "▲" : "▼"}</span>
          </button>
          {statsExpanded && (
            <div className="px-4 pb-4 flex flex-col gap-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted">Total arbs detected</span>
                <span className="text-foreground font-mono">{stats.totalDetected24h}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Arbs still active</span>
                <span className="text-foreground font-mono">{stats.activeNow}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Highest arb percentage</span>
                <span className="text-accent font-mono">
                  {stats.highestArbPercentage24h !== null ? `${stats.highestArbPercentage24h.toFixed(2)}%` : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Most common market</span>
                <span className="text-foreground font-mono">{stats.mostCommonMarket ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Most profitable book pair</span>
                <span className="text-foreground font-mono">{stats.mostProfitableBookPair ?? "—"}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
