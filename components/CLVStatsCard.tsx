"use client";

import { useState } from "react";
import type { BetEntry } from "@/types/odds";

const THRESHOLDS = [1, 2, 3, 4];

export function CLVStatsCard({ bets }: { bets: BetEntry[] }) {
  const [expanded, setExpanded] = useState(false);

  const withClv = bets.filter((b): b is BetEntry & { clvPercentage: number } => b.clvPercentage !== null);
  const avgClv = withClv.length > 0 ? withClv.reduce((sum, b) => sum + b.clvPercentage, 0) / withClv.length : null;
  const totalStake = bets.reduce((sum, b) => sum + (b.stake ?? 0), 0);
  const expectedValue = avgClv !== null ? (avgClv / 100) * totalStake : null;

  return (
    <div className="rounded-lg border border-border bg-surface">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold"
      >
        CLV Statistics
        <span className="text-muted text-xs">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-2 text-xs">
          <div className="flex justify-between">
            <span className="text-muted">Average CLV</span>
            <span className={avgClv === null ? "text-muted" : avgClv >= 0 ? "text-accent" : "text-danger"}>
              {avgClv === null ? "—" : `${avgClv > 0 ? "+" : ""}${avgClv.toFixed(2)}%`}
            </span>
          </div>
          {THRESHOLDS.map((t) => {
            const count = withClv.filter((b) => b.clvPercentage >= t).length;
            return (
              <div key={t} className="flex justify-between">
                <span className="text-muted">Bets above {t}%</span>
                <span className="text-foreground font-mono">
                  {count} out of {bets.length}
                </span>
              </div>
            );
          })}
          <div className="flex justify-between">
            <span className="text-muted">Total stake (open bets)</span>
            <span className="text-foreground font-mono">${totalStake.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Expected value</span>
            <span className={expectedValue === null ? "text-muted" : expectedValue >= 0 ? "text-accent" : "text-danger"}>
              {expectedValue === null ? "—" : `${expectedValue >= 0 ? "+" : ""}$${expectedValue.toFixed(2)}`}
            </span>
          </div>
          <p className="text-muted pt-1 border-t border-border mt-1">
            Win rate isn&apos;t shown — grading bets as won/lost isn&apos;t built yet, only marking them
            closed with a closing price. Expected value here is a simplified avg-CLV × stake estimate,
            not a true EV model based on actual outcomes.
          </p>
        </div>
      )}
    </div>
  );
}
