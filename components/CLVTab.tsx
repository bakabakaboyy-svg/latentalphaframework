"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BetEntry, CLVResponse, MarketType } from "@/types/odds";
import { SportMarketFilters, type SportFilter } from "./filters";
import { BetEntryForm } from "./BetEntryForm";
import { CLVTable } from "./CLVTable";
import { CLVStatsCard } from "./CLVStatsCard";
import { useToasts, ToastContainer } from "./Toast";

const REFRESH_INTERVAL_MS = 60_000;

function logError(context: string, err: unknown) {
  console.error(`[CLVTab ${new Date().toISOString()}] ${context}:`, err);
}

function formatLastUpdated(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function CLVTab({
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
  const [bets, setBets] = useState<BetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0);

  // Tracks each bet's CLV from the previous fetch, so we can detect it
  // freshly crossing the active threshold — a ref because it's only read/
  // written from the fetch callback, never during render.
  const prevClvById = useRef<Map<number, number | null>>(new Map());

  const fetchBets = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ status: "open", market_type: market });
      if (sport !== "all") params.set("sport", sport);
      const res = await fetch(`/api/clv?${params.toString()}`);
      const json: CLVResponse = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load bets");

      if (threshold > 0) {
        for (const bet of json.bets) {
          const prev = prevClvById.current.get(bet.id);
          const crossedUp = (prev === undefined || prev === null || prev < threshold) && bet.clvPercentage !== null && bet.clvPercentage >= threshold;
          if (crossedUp) {
            showToast(`⚠️ This bet crossed your ${threshold}%+ threshold!`, "warning");
          }
        }
      }
      prevClvById.current = new Map(json.bets.map((b) => [b.id, b.clvPercentage]));

      setBets(json.bets);
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      logError("fetchBets failed", err);
      setError("Failed to load CLV data. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, [sport, market, threshold, showToast]);

  useEffect(() => {
    const timeoutId = setTimeout(fetchBets, 0);
    return () => clearTimeout(timeoutId);
  }, [fetchBets]);

  // Auto-refresh every minute while visible, same pattern as STEAM tab.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalId) return;
      intervalId = setInterval(fetchBets, REFRESH_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchBets();
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
  }, [fetchBets]);

  return (
    <div className="flex flex-col gap-4">
      <ToastContainer toasts={toasts} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SportMarketFilters sport={sport} market={market} onSportChange={onSportChange} onMarketChange={onMarketChange} />
        <span className="text-xs font-mono text-muted">
          {lastUpdated ? `Last updated: ${formatLastUpdated(lastUpdated)}` : "—"}
        </span>
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
      )}

      <div className="flex flex-col md:flex-row gap-4 items-start">
        <div className="w-full md:w-[30%] md:sticky md:top-4">
          <BetEntryForm sport={sport} showToast={showToast} onBetLogged={fetchBets} />
        </div>

        <div className="w-full md:w-[70%] flex flex-col gap-4">
          <CLVTable
            bets={bets}
            loading={loading}
            threshold={threshold}
            onThresholdChange={setThreshold}
            onBetClosed={fetchBets}
            showToast={showToast}
          />
          <CLVStatsCard bets={bets} />
        </div>
      </div>
    </div>
  );
}
