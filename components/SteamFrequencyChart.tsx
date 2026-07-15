"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { SteamMove } from "@/types/odds";

interface HourBucket {
  hourLabel: string;
  hourStart: number;
  count: number;
  games: string[];
}

function buildHourBuckets(steamMoves: SteamMove[]): HourBucket[] {
  const now = Date.now();
  const buckets: HourBucket[] = [];
  for (let i = 23; i >= 0; i--) {
    const hourStart = now - i * 60 * 60 * 1000;
    const date = new Date(hourStart);
    buckets.push({
      hourLabel: date.toLocaleTimeString(undefined, { hour: "numeric" }),
      hourStart,
      count: 0,
      games: [],
    });
  }

  for (const move of steamMoves) {
    const t = new Date(move.detectedAt).getTime();
    // Find the bucket whose hour window contains this move (each bucket
    // covers [hourStart, hourStart + 1hr)).
    const bucket = buckets.find((b, i) => {
      const nextStart = i < buckets.length - 1 ? buckets[i + 1].hourStart : Infinity;
      return t >= b.hourStart && t < nextStart;
    });
    if (!bucket) continue;
    bucket.count += 1;
    const gameLabel = `${move.awayTeam} @ ${move.homeTeam}`;
    if (!bucket.games.includes(gameLabel)) bucket.games.push(gameLabel);
  }

  return buckets;
}

interface TooltipPayloadItem {
  payload: HourBucket;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const bucket = payload[0].payload;
  if (bucket.count === 0) return null;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-mono max-w-xs">
      <div className="text-foreground">{bucket.count} steam move{bucket.count === 1 ? "" : "s"}</div>
      {bucket.games.slice(0, 5).map((g) => (
        <div key={g} className="text-muted">
          {g}
        </div>
      ))}
      {bucket.games.length > 5 && <div className="text-muted">+{bucket.games.length - 5} more</div>}
    </div>
  );
}

export function SteamFrequencyChart({ steamMoves }: { steamMoves: SteamMove[] }) {
  const data = buildHourBuckets(steamMoves);

  return (
    <div>
      <div className="text-xs font-mono uppercase text-muted mb-3">Steam Move Frequency (Last 24 Hours)</div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
          <XAxis dataKey="hourLabel" stroke="#71717a" fontSize={11} interval={2} />
          <YAxis stroke="#71717a" fontSize={11} allowDecimals={false} width={24} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
          <Bar dataKey="count" fill="#22c55e" radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
