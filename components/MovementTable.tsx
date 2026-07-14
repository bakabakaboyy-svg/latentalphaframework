import type { MovementLineEntry } from "@/types/odds";

function formatPrice(price: number): string {
  return price > 0 ? `+${price}` : `${price}`;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

interface Row {
  bookName: string;
  isSharp: boolean;
  outcomeName: string;
  opening: number | null;
  current: number;
  currentRecordedAt: string;
}

export function MovementTable({
  openingLines,
  currentLines,
}: {
  openingLines: MovementLineEntry[];
  currentLines: MovementLineEntry[];
}) {
  const openingByKey = new Map(openingLines.map((l) => [`${l.bookSlug}|${l.outcomeName}`, l]));

  const rows: Row[] = currentLines
    .map((cur) => {
      const opening = openingByKey.get(`${cur.bookSlug}|${cur.outcomeName}`);
      return {
        bookName: cur.bookName,
        isSharp: cur.isSharp,
        outcomeName: cur.outcomeName,
        opening: opening ? opening.price : null,
        current: cur.price,
        currentRecordedAt: cur.recordedAt,
      };
    })
    .sort((a, b) => b.currentRecordedAt.localeCompare(a.currentRecordedAt));

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
        No line movement data yet for this game.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            {["BOOK", "OUTCOME", "OPENING", "CURRENT", "CHANGE", "DIRECTION", "TIMESTAMP"].map((h) => (
              <th key={h} className="px-4 py-2 font-mono uppercase text-muted text-[11px] font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const change = row.opening !== null ? row.current - row.opening : null;
            const direction = change === null || change === 0 ? "flat" : change > 0 ? "up" : "down";
            return (
              <tr
                key={`${row.bookName}-${row.outcomeName}`}
                className={`border-t border-border hover:bg-[#1a1a1a] transition-colors ${i % 2 === 0 ? "bg-surface" : "bg-[#0f0f0f]"}`}
              >
                <td className={`px-4 py-2 whitespace-nowrap ${row.isSharp ? "text-accent" : "text-foreground"}`}>{row.bookName}</td>
                <td className="px-4 py-2 whitespace-nowrap text-foreground">{row.outcomeName}</td>
                <td className="px-4 py-2 font-mono whitespace-nowrap text-muted">
                  {row.opening !== null ? formatPrice(row.opening) : "—"}
                </td>
                <td className="px-4 py-2 font-mono whitespace-nowrap text-foreground">{formatPrice(row.current)}</td>
                <td className="px-4 py-2 font-mono whitespace-nowrap">{change === null ? "—" : `${change > 0 ? "+" : ""}${change}`}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {direction === "up" && <span className="text-accent">↑</span>}
                  {direction === "down" && <span className="text-danger">↓</span>}
                  {direction === "flat" && <span className="text-muted">→</span>}
                </td>
                <td className="px-4 py-2 font-mono whitespace-nowrap text-muted">{formatTimestamp(row.currentRecordedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
