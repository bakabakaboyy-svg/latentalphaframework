"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { MovementSeries } from "@/types/odds";

function seriesKey(s: MovementSeries): string {
  return `${s.bookSlug}|${s.outcomeName}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

type ChartRow = { time: string } & Record<string, number | null | string>;

function buildChartData(series: MovementSeries[]): ChartRow[] {
  const allTimes = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.time)))).sort();
  return allTimes.map((time) => {
    const row: ChartRow = { time };
    for (const s of series) {
      const point = s.points.find((p) => p.time === time);
      row[seriesKey(s)] = point ? point.price : null;
    }
    return row;
  });
}

interface TooltipPayloadItem {
  dataKey: string;
  value: number | null;
  color: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  series,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  series: MovementSeries[];
}) {
  if (!active || !payload || payload.length === 0 || !label) return null;
  const seriesByKey = new Map(series.map((s) => [seriesKey(s), s]));

  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-mono max-w-xs">
      <div className="text-muted mb-1">{formatTime(label)}</div>
      {payload
        .filter((p) => p.value !== null)
        .map((p) => {
          const s = seriesByKey.get(p.dataKey);
          if (!s) return null;
          return (
            <div key={p.dataKey} className="flex justify-between gap-3" style={{ color: p.color }}>
              <span>
                {s.bookName} — {s.outcomeName}
              </span>
              <span>{p.value! > 0 ? `+${p.value}` : p.value}</span>
            </div>
          );
        })}
    </div>
  );
}

// Regular books use the app's muted text color rather than the spec's literal
// #71717a-vs-#22c55e pairing being reused identically here — same colors as
// OpeningLineChart, so sharp vs. regular reads consistently across both charts.
const SHARP_COLOR = "#22c55e";
const REGULAR_COLOR = "#71717a";

export function PriceHistoryChart({ priceHistory }: { priceHistory: MovementSeries[] }) {
  if (priceHistory.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
        No price history yet for this game.
      </div>
    );
  }

  const data = buildChartData(priceHistory);

  return (
    <div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
          <XAxis dataKey="time" tickFormatter={formatTime} stroke="#71717a" fontSize={11} />
          <YAxis stroke="#71717a" fontSize={11} domain={["auto", "auto"]} />
          <Tooltip content={<ChartTooltip series={priceHistory} />} />
          {priceHistory.map((s) => (
            <Line
              key={seriesKey(s)}
              type="monotone"
              dataKey={seriesKey(s)}
              stroke={s.isSharp ? SHARP_COLOR : REGULAR_COLOR}
              strokeWidth={s.isSharp ? 2 : 1.5}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="text-[11px] text-muted text-center mt-1">Live line movement since market open</div>
    </div>
  );
}
