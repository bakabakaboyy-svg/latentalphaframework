"use client";

import { useCallback, useEffect, useState } from "react";
import type { GameWithOdds, SportSlug, MarketType, ScrapeResult, OddsResponse } from "@/types/odds";
import { SkeletonTable } from "./Skeleton";
import { OddsTable, type Timezone } from "./OddsTable";

const SPORTS: { slug: SportSlug | "all"; label: string }[] = [
  { slug: "all", label: "ALL" },
  { slug: "mlb", label: "MLB" },
  { slug: "wnba", label: "WNBA" },
  { slug: "tennis", label: "TENNIS" },
  { slug: "soccer", label: "SOCCER" },
  { slug: "cs2", label: "CS2" },
];

const MARKETS: { slug: MarketType; label: string }[] = [
  { slug: "h2h", label: "MONEYLINE" },
  { slug: "spreads", label: "SPREAD" },
  { slug: "totals", label: "TOTAL" },
];

const TIMEZONES: Timezone[] = ["EST", "CST", "PST"];

function logError(context: string, err: unknown) {
  console.error(`[LinesTab ${new Date().toISOString()}] ${context}:`, err);
}

function formatLastUpdated(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
        active
          ? "bg-accent/10 border-accent text-accent"
          : "bg-surface border-border text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={`w-3.5 h-3.5 ${spinning ? "animate-spin" : ""}`}
    >
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

export function LinesTab() {
  const [sport, setSport] = useState<SportSlug | "all">("all");
  const [market, setMarket] = useState<MarketType>("h2h");
  const [timezone, setTimezone] = useState<Timezone>("EST");
  const [games, setGames] = useState<GameWithOdds[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOdds = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ market_type: market });
      if (sport !== "all") params.set("sport", sport);

      const res = await fetch(`/api/odds?${params.toString()}`);
      const data: OddsResponse = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load odds");

      setGames(data.games);
      setLastUpdated(data.lastUpdated);
    } catch (err) {
      logError("fetchOdds failed", err);
      setError("Failed to load odds. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, [sport, market]);

  useEffect(() => {
    const timeoutId = setTimeout(fetchOdds, 0);
    return () => clearTimeout(timeoutId);
  }, [fetchOdds]);

  const handleRefresh = useCallback(async () => {
    setScraping(true);
    setError(null);
    try {
      const res = await fetch("/api/scrape/manual", { method: "POST" });
      const data: ScrapeResult = await res.json();
      if (!res.ok || !data.success) {
        const detail = data.errors?.[0] ?? "Unknown scraper error";
        throw new Error(detail);
      }
    } catch (err) {
      logError("scrape/manual failed", err);
      setError(err instanceof Error ? err.message : "Failed to pull live odds.");
    } finally {
      setScraping(false);
    }
    await fetchOdds();
  }, [fetchOdds]);

  const busy = loading || scraping;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {SPORTS.map((s) => (
            <FilterButton key={s.slug} active={sport === s.slug} onClick={() => setSport(s.slug)}>
              {s.label}
            </FilterButton>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 text-xs font-mono text-muted">
            {TIMEZONES.map((tz, i) => (
              <span key={tz} className="flex items-center gap-1">
                {i > 0 && <span className="text-border">|</span>}
                <button
                  onClick={() => setTimezone(tz)}
                  className={timezone === tz ? "text-accent" : "text-muted hover:text-foreground"}
                >
                  {tz}
                </button>
              </span>
            ))}
          </div>
          <span className="text-xs font-mono text-muted">
            {lastUpdated ? `Last updated: ${formatLastUpdated(lastUpdated)}` : "—"}
          </span>
          <button
            onClick={handleRefresh}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-surface text-foreground hover:border-accent disabled:opacity-50 transition-colors"
          >
            <RefreshIcon spinning={busy} />
            {scraping ? "PULLING LIVE ODDS…" : "REFRESH"}
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        {MARKETS.map((m) => (
          <FilterButton key={m.slug} active={market === m.slug} onClick={() => setMarket(m.slug)}>
            {m.label}
          </FilterButton>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {loading && games.length === 0 && <SkeletonTable />}

      {!loading && !error && games.length === 0 && (
        <div className="rounded-md border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
          No data yet. Click REFRESH to pull live odds.
        </div>
      )}

      {games.length > 0 && <OddsTable games={games} timezone={timezone} />}
    </div>
  );
}
