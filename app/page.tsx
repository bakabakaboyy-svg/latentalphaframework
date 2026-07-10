"use client";

import { useState } from "react";
import { NavTabs, type Tab } from "@/components/NavTabs";
import { LinesTab } from "@/components/LinesTab";
import { ComingSoon } from "@/components/ComingSoon";

export default function Home() {
  const [tab, setTab] = useState<Tab>("LINES");

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
        {tab === "LINES" ? <LinesTab /> : <ComingSoon tabName={tab} />}
      </main>
    </div>
  );
}
