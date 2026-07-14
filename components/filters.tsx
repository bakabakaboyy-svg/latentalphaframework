import type { SportSlug, MarketType } from "@/types/odds";

export type SportFilter = SportSlug | "all";

export const SPORTS: { slug: SportFilter; label: string }[] = [
  { slug: "all", label: "ALL" },
  { slug: "mlb", label: "MLB" },
  { slug: "wnba", label: "WNBA" },
  { slug: "tennis", label: "TENNIS" },
  { slug: "soccer", label: "SOCCER" },
  { slug: "cs2", label: "CS2" },
];

export const MARKETS: { slug: MarketType; label: string }[] = [
  { slug: "h2h", label: "MONEYLINE" },
  { slug: "spreads", label: "SPREAD" },
  { slug: "totals", label: "TOTAL" },
];

export function FilterButton({
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

// Shared sport + market filter rows, used identically on LINES and MOVEMENT
// so switching either from one tab is reflected on the other (state lives in
// the URL, owned by app/page.tsx).
export function SportMarketFilters({
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
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {SPORTS.map((s) => (
          <FilterButton key={s.slug} active={sport === s.slug} onClick={() => onSportChange(s.slug)}>
            {s.label}
          </FilterButton>
        ))}
      </div>
      <div className="flex gap-2">
        {MARKETS.map((m) => (
          <FilterButton key={m.slug} active={market === m.slug} onClick={() => onMarketChange(m.slug)}>
            {m.label}
          </FilterButton>
        ))}
      </div>
    </div>
  );
}
