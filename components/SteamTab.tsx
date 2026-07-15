"use client";

import { useCallback, useEffect, useState } from "react";
import type { MarketType, SteamMove, SteamResponse } from "@/types/odds";
import { SportMarketFilters, type SportFilter } from "./filters";
import { SteamFrequencyChart } from "./SteamFrequencyChart";

const MARKET_LABELS: Record<MarketType, string> = { h2h: "MONEYLINE", spreads: "SPREAD", totals: "TOTAL" };
const REFRESH_INTERVAL_MS = 60_000;
const LIVE_WINDOW_MINUTES = 60;

function logError(context: string, err: unknown) {
  console.error(`[SteamTab ${new Date().toISOString()}] ${context}:`, err);
}

function formatPrice(price: number): string {
  return price > 0 ? `+${price}` : `${price}`;
}

function isWithinLiveWindow(iso: string): boolean {
  return new Date(iso).getTime() >= Date.now() - LIVE_WINDOW_MINUTES * 60 * 1000;
}

function formatRelativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

interface GameGroup {
  gameId: number;
  homeTeam: string;
  awayTeam: string;
  moves: SteamMove[];
}

// HISTORY MODE groups moves by game. Moves arrive newest-first from the API,
// so both the group order (by each group's most recent move) and the moves
// within a group stay chronological.
function groupByGame(moves: SteamMove[]): GameGroup[] {
  const order: number[] = [];
  const groups = new Map<number, GameGroup>();
  for (const move of moves) {
    let group = groups.get(move.gameId);
    if (!group) {
      group = { gameId: move.gameId, homeTeam: move.homeTeam, awayTeam: move.awayTeam, moves: [] };
      groups.set(move.gameId, group);
      order.push(move.gameId);
    }
    group.moves.push(move);
  }
  return order.map((id) => groups.get(id)!);
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

function SteamCard({
  move,
  condensed,
  showGame = true,
}: {
  move: SteamMove;
  condensed: boolean;
  showGame?: boolean;
}) {
  const isUp = move.direction === "up";
  const arrow = isUp ? "↗" : "↘";
  const arrowColor = isUp ? "text-accent" : "text-danger";
  const priceDiff = move.priceAfter - move.priceBefore;

  if (condensed) {
    return (
      <div className="rounded-md border-l-2 border-accent bg-surface px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`${arrowColor} font-bold`}>{arrow}</span>
          {showGame && (
            <span className="text-foreground whitespace-nowrap">
              {move.awayTeam} @ {move.homeTeam}
            </span>
          )}
          <span className="text-muted whitespace-nowrap">
            {MARKET_LABELS[move.marketType]} · {move.outcomeName} · {move.triggerBook}
          </span>
        </div>
        <span className="text-muted font-mono whitespace-nowrap">{formatRelativeTime(move.detectedAt)}</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border border-l-2 border-l-accent bg-surface p-4 flex flex-col gap-2 fade-in-row">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">
          {move.awayTeam} <span className="text-muted">@</span> {move.homeTeam}
        </div>
        <span className={`text-lg ${arrowColor}`}>{arrow} STEAM</span>
      </div>
      <div className="text-xs text-muted">
        {MARKET_LABELS[move.marketType]} · {move.outcomeName}
      </div>
      <div className="text-xs text-foreground">Moved first at {move.triggerBook}</div>
      <div className="text-xs text-muted">
        {move.booksMoved} other book{move.booksMoved === 1 ? "" : "s"} followed within 5 minutes
      </div>
      <div className="text-xs font-mono text-foreground">
        {move.triggerBook} {formatPrice(move.priceBefore)} → {formatPrice(move.priceAfter)} (
        <span className={arrowColor}>
          {priceDiff > 0 ? "+" : ""}
          {priceDiff} cents
        </span>
        )
      </div>
      <div className="text-xs text-muted">Detected {formatRelativeTime(move.detectedAt)}</div>
    </div>
  );
}

export function SteamTab({
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
  const [mode, setMode] = useState<"LIVE" | "HISTORY">("LIVE");
  const [data, setData] = useState<SteamResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  // Always fetch a 24h window — LIVE mode just filters that down to the last
  // hour client-side, so one fetch serves both modes and the frequency chart
  // without re-requesting on every toggle.
  const fetchSteam = useCallback(async () => {
    setSpinning(true);
    setError(null);
    try {
      const params = new URLSearchParams({ market_type: market, hours: "24" });
      if (sport !== "all") params.set("sport", sport);
      const res = await fetch(`/api/steam?${params.toString()}`);
      const json: SteamResponse = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load steam moves");
      setData(json);
      setHasLoadedOnce(true);
    } catch (err) {
      logError("fetchSteam failed", err);
      setError("Steam detection temporarily unavailable. Retrying...");
    } finally {
      setLoading(false);
      setSpinning(false);
    }
  }, [sport, market]);

  useEffect(() => {
    const timeoutId = setTimeout(fetchSteam, 0);
    return () => clearTimeout(timeoutId);
  }, [fetchSteam]);

  // Auto-refresh every minute while the tab/document is visible; pause when
  // hidden, resume (with an immediate refetch) when it becomes visible again.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalId) return;
      intervalId = setInterval(fetchSteam, REFRESH_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchSteam();
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
  }, [fetchSteam]);

  const allMoves = data?.steamMoves ?? [];
  const liveMoves = allMoves.filter((m) => isWithinLiveWindow(m.detectedAt));
  const displayedMoves = mode === "LIVE" ? liveMoves : allMoves;

  return (
    <div className="flex flex-col gap-4">
      <SportMarketFilters sport={sport} market={market} onSportChange={onSportChange} onMarketChange={onMarketChange} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">🔥 {mode === "LIVE" ? "LIVE STEAM MOVES" : "STEAM HISTORY"}</h2>
          <div className="flex items-center gap-1 text-xs font-mono">
            <button
              onClick={() => setMode("LIVE")}
              className={mode === "LIVE" ? "text-accent" : "text-muted hover:text-foreground"}
            >
              LIVE MODE
            </button>
            <span className="text-border">|</span>
            <button
              onClick={() => setMode("HISTORY")}
              className={mode === "HISTORY" ? "text-accent" : "text-muted hover:text-foreground"}
            >
              HISTORY MODE
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-mono text-muted">
          <RefreshIcon spinning={spinning} />
          Auto-refreshing every 1 min
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
      )}

      {loading && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="skeleton rounded-lg h-24 w-full" />
          ))}
        </div>
      )}

      {!loading && !error && displayedMoves.length === 0 && (
        <div className="rounded-md border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
          {!hasLoadedOnce
            ? "No steam data yet. Check back in a few minutes."
            : mode === "LIVE"
              ? "No steam moves detected in the last hour. Market is quiet."
              : "No steam moves detected in the last 24 hours."}
        </div>
      )}

      {!loading && mode === "LIVE" && displayedMoves.length > 0 && (
        <div className="flex flex-col gap-3">
          {displayedMoves.map((move) => (
            <SteamCard key={move.id} move={move} condensed={false} />
          ))}
        </div>
      )}

      {!loading && mode === "HISTORY" && displayedMoves.length > 0 && (
        <div className="flex flex-col gap-4">
          {groupByGame(displayedMoves).map((group) => (
            <div key={group.gameId} className="flex flex-col gap-1.5">
              <div className="text-xs font-medium text-foreground">
                {group.awayTeam} <span className="text-muted">@</span> {group.homeTeam}
              </div>
              {group.moves.map((move) => (
                <SteamCard key={move.id} move={move} condensed showGame={false} />
              ))}
            </div>
          ))}
        </div>
      )}

      {!loading && allMoves.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4 mt-2">
          <SteamFrequencyChart steamMoves={allMoves} />
        </div>
      )}
    </div>
  );
}
