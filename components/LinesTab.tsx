"use client";

import { useCallback, useEffect, useState } from "react";
import type { OddsApiRow, SportSlug, MarketType } from "@/types/odds";
import { SkeletonTable } from "./Skeleton";
import { OddsTable } from "./OddsTable";

const SPORTS: { slug: SportSlug; label: string }[] = [
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

export function LinesTab() {
  const [sport, setSport] = useState<SportSlug>("mlb");
  const [market, setMarket] = useState<MarketType>("h2h");
  const [rows, setRows] = useState<OddsApiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchOdds = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ sport, market_type: market });
      const res = await fetch(`/api/odds?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load odds");
      setRows(data.rows ?? []);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sport, market]);

  useEffect(() => {
    const timeoutId = setTimeout(fetchOdds, 0);
    return () => clearTimeout(timeoutId);
  }, [fetchOdds]);

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
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-muted">
            {lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString()}` : "—"}
          </span>
          <button
            onClick={fetchOdds}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-surface text-foreground hover:border-accent disabled:opacity-50 transition-colors"
          >
            {loading ? "Refreshing…" : "Refresh"}
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

      {loading && rows.length === 0 && <SkeletonTable />}

      {!loading && !error && rows.length === 0 && (
        <div className="rounded-md border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
          No odds data yet for {sport.toUpperCase()}. Run the scraper (POST /api/scrape) to populate data.
        </div>
      )}

      {rows.length > 0 && <OddsTable rows={rows} />}
    </div>
  );
}
