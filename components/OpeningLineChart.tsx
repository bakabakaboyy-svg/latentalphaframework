"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { MovementLineEntry } from "@/types/odds";

type ChartRow = MovementLineEntry & { label: string };

function formatPrice(price: number): string {
  return price > 0 ? `+${price}` : `${price}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-mono">
      <div className="text-foreground">{row.label}</div>
      <div className="text-muted">
        {formatPrice(row.price)}
        {row.point !== null && ` (${row.point > 0 ? "+" : ""}${row.point})`}
      </div>
      <div className="text-muted">Opened {formatTime(row.recordedAt)}</div>
    </div>
  );
}

// Regular books use the app's muted text color rather than the spec's literal
// #1f1f1f — that shade is nearly the same as the chart's own border/background
// on our dark theme and the bars would be almost invisible. #71717a keeps the
// same "muted vs. sharp accent" contrast but stays legible.
const SHARP_COLOR = "#22c55e";
const REGULAR_COLOR = "#71717a";
const PREDICTION_MARKET_COLOR = "#8b5cf6";

function colorFor(entry: { isSharp: boolean; isPredictionMarket: boolean }): string {
  if (entry.isPredictionMarket) return PREDICTION_MARKET_COLOR;
  return entry.isSharp ? SHARP_COLOR : REGULAR_COLOR;
}

export function OpeningLineChart({ openingLines }: { openingLines: MovementLineEntry[] }) {
  if (openingLines.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
        No opening lines recorded yet for this game.
      </div>
    );
  }

  const data: ChartRow[] = openingLines
    .map((line) => ({ ...line, label: `${line.bookName} — ${line.outcomeName}` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div>
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 36)}>
        <BarChart data={data} layout="vertical" margin={{ left: 24, right: 24, top: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" horizontal={false} />
          <XAxis type="number" stroke="#71717a" fontSize={11} />
          <YAxis type="category" dataKey="label" stroke="#71717a" fontSize={11} width={170} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
          <Bar dataKey="price" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {data.map((entry, i) => (
              <Cell key={i} fill={colorFor(entry)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="text-[11px] text-muted text-center mt-1">Opening lines recorded at market open</div>
    </div>
  );
}
