"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { NavTabs, type Tab } from "@/components/NavTabs";
import { LinesTab } from "@/components/LinesTab";
import { MovementTab } from "@/components/MovementTab";
import { ComingSoon } from "@/components/ComingSoon";
import type { MarketType } from "@/types/odds";
import type { SportFilter } from "@/components/filters";

// Sport/market filters live in the URL (?sport=mlb&market=h2h) rather than
// component state, so switching tabs — or reloading the page — keeps the
// same filters instead of resetting them.
function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>("LINES");

  const sport = (searchParams.get("sport") as SportFilter | null) ?? "all";
  const market = (searchParams.get("market") as MarketType | null) ?? "h2h";

  const updateParams = useCallback(
    (next: { sport?: SportFilter; market?: MarketType }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.sport) params.set("sport", next.sport);
      if (next.market) params.set("market", next.market);
      router.replace(`/?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const handleSportChange = useCallback((s: SportFilter) => updateParams({ sport: s }), [updateParams]);
  const handleMarketChange = useCallback((m: MarketType) => updateParams({ market: m }), [updateParams]);

  return (
    <div className="flex flex-col flex-1 bg-background">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">
          LAF <span className="text-muted font-normal">— Latent Alpha Framework</span>
        </h1>
      </header>

      <div className="px-6 pt-2">
        <NavTabs active={tab} onChange={setTab} />
      </div>

      <main className="flex-1 px-6 py-6">
        {tab === "LINES" && (
          <LinesTab sport={sport} market={market} onSportChange={handleSportChange} onMarketChange={handleMarketChange} />
        )}
        {tab === "MOVEMENT" && (
          <MovementTab sport={sport} market={market} onSportChange={handleSportChange} onMarketChange={handleMarketChange} />
        )}
        {tab !== "LINES" && tab !== "MOVEMENT" && <ComingSoon tabName={tab} />}
      </main>
    </div>
  );
}

// useSearchParams() means DashboardContent can't be statically rendered, so
// Next.js ships a blank shell for it until client JS hydrates. This fallback
// (the header + a skeleton) is what paints in that gap instead of nothing.
function DashboardSkeleton() {
  return (
    <div className="flex flex-col flex-1 bg-background">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">
          LAF <span className="text-muted font-normal">— Latent Alpha Framework</span>
        </h1>
      </header>
      <main className="flex-1 px-6 py-6">
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="skeleton rounded-md h-16 w-full" />
          ))}
        </div>
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent />
    </Suspense>
  );
}
