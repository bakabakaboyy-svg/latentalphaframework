"use client";

import { useState } from "react";
import type { BetEntry, MarketType } from "@/types/odds";
import { FilterButton } from "./filters";
import type { ToastVariant } from "./Toast";

const MARKET_LABELS: Record<MarketType, string> = { h2h: "MONEYLINE", spreads: "SPREAD", totals: "TOTAL" };
const THRESHOLDS = [1, 2, 3, 4];

function formatPrice(price: number): string {
  return price > 0 ? `+${price}` : `${price}`;
}

function formatOutcome(bet: BetEntry): string {
  if (bet.marketType === "h2h") return bet.outcomeName;
  if (bet.point === null) return bet.outcomeName;
  return `${bet.outcomeName} ${bet.point > 0 ? "+" : ""}${bet.point}`;
}

function clvColorClass(clv: number | null): string {
  if (clv === null) return "text-muted";
  if (clv > 0.5) return "text-accent";
  if (clv < -0.5) return "text-danger";
  return "text-muted";
}

function thresholdLabel(clv: number | null): string {
  if (clv === null) return "—";
  for (let i = THRESHOLDS.length - 1; i >= 0; i--) {
    if (clv >= THRESHOLDS[i]) return `${THRESHOLDS[i]}%+`;
  }
  return "—";
}

function CloseBetControl({
  bet,
  onClose,
}: {
  bet: BetEntry;
  onClose: (betId: number, closingPrice: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(() => (bet.currentPrice !== null ? String(bet.currentPrice) : ""));
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="px-2 py-1 text-[11px] rounded border border-border text-muted hover:text-foreground hover:border-accent transition-colors"
      >
        Close
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-16 rounded border border-border bg-background px-1.5 py-1 text-[11px] font-mono text-foreground"
        autoFocus
      />
      <button
        disabled={saving || value === ""}
        onClick={async () => {
          setSaving(true);
          await onClose(bet.id, Number(value));
          setSaving(false);
          setEditing(false);
        }}
        className="px-1.5 py-1 text-[11px] rounded bg-accent text-background disabled:opacity-50"
      >
        ✓
      </button>
      <button
        onClick={() => setEditing(false)}
        className="px-1.5 py-1 text-[11px] rounded border border-border text-muted"
      >
        ✕
      </button>
    </div>
  );
}

export function CLVTable({
  bets,
  loading,
  threshold,
  onThresholdChange,
  onBetClosed,
  showToast,
}: {
  bets: BetEntry[];
  loading: boolean;
  threshold: number;
  onThresholdChange: (threshold: number) => void;
  onBetClosed: () => void;
  showToast: (message: string, variant?: ToastVariant) => void;
}) {
  const filteredBets = threshold === 0 ? bets : bets.filter((b) => b.clvPercentage !== null && b.clvPercentage >= threshold);

  async function handleClose(betId: number, closingPrice: number) {
    try {
      const res = await fetch("/api/clv", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ betId, status: "closed", closingPrice }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed to close bet");
      showToast("Bet marked closed.", "success");
      onBetClosed();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to close bet", "error");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <FilterButton active={threshold === 0} onClick={() => onThresholdChange(0)}>
          ALL
        </FilterButton>
        {THRESHOLDS.map((t) => (
          <FilterButton key={t} active={threshold === t} onClick={() => onThresholdChange(t)}>
            {t}%+
          </FilterButton>
        ))}
      </div>

      {loading && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="skeleton rounded-md h-10 w-full" />
          ))}
        </div>
      )}

      {!loading && filteredBets.length === 0 && (
        <div className="rounded-md border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
          {bets.length === 0 ? "No open bets logged yet. Use the form to log your first one." : "No bets meet this threshold."}
        </div>
      )}

      {!loading && filteredBets.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                {["GAME", "MARKET", "OUTCOME", "BOOK", "ENTRY", "CURRENT", "CHANGE", "CLV%", "THRESHOLD", "ACTION"].map((h) => (
                  <th key={h} className="px-3 py-2 font-mono uppercase text-muted text-[11px] font-normal whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredBets.map((bet, i) => {
                const change = bet.currentPrice !== null ? bet.currentPrice - bet.entryPrice : null;
                return (
                  <tr
                    key={bet.id}
                    className={`border-t border-border hover:bg-[#1a1a1a] transition-colors ${i % 2 === 0 ? "bg-surface" : "bg-[#0f0f0f]"}`}
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-foreground">
                      {bet.awayTeam} @ {bet.homeTeam}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted">{MARKET_LABELS[bet.marketType]}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-foreground">{formatOutcome(bet)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted">{bet.bookName}</td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap text-foreground">{formatPrice(bet.entryPrice)}</td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap text-foreground">
                      {bet.currentPrice !== null ? formatPrice(bet.currentPrice) : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap">
                      {change === null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <span className={clvColorClass(bet.clvPercentage)}>
                          {change > 0 ? "+" : ""}
                          {change}
                        </span>
                      )}
                    </td>
                    <td className={`px-3 py-2 font-mono whitespace-nowrap ${clvColorClass(bet.clvPercentage)}`}>
                      {bet.clvPercentage !== null ? `${bet.clvPercentage > 0 ? "+" : ""}${bet.clvPercentage.toFixed(2)}%` : "—"}
                    </td>
                    <td className={`px-3 py-2 font-mono whitespace-nowrap ${clvColorClass(bet.clvPercentage)}`}>
                      {thresholdLabel(bet.clvPercentage)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <CloseBetControl bet={bet} onClose={handleClose} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
