import type { OddsApiRow } from "@/types/odds";

function formatGameTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatPrice(price: number): string {
  return price > 0 ? `+${price}` : `${price}`;
}

interface BookColumn {
  slug: string;
  name: string;
  isSharp: boolean;
}

interface GameCardProps {
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  rows: OddsApiRow[]; // pre-filtered to a single game + single market_type
  bookColumns: BookColumn[];
}

function outcomeOrder(outcomeName: string, homeTeam: string, awayTeam: string): number {
  if (outcomeName === awayTeam) return 0;
  if (outcomeName === homeTeam) return 1;
  if (outcomeName === "Over") return 0;
  if (outcomeName === "Under") return 1;
  return 2;
}

function GameCard({ homeTeam, awayTeam, commenceTime, rows, bookColumns }: GameCardProps) {
  const outcomeNames = Array.from(new Set(rows.map((r) => r.outcomeName))).sort(
    (a, b) => outcomeOrder(a, homeTeam, awayTeam) - outcomeOrder(b, homeTeam, awayTeam)
  );

  const cell = (outcomeName: string, bookSlug: string) =>
    rows.find((r) => r.outcomeName === outcomeName && r.bookSlug === bookSlug);

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="text-sm font-medium">
          {awayTeam} <span className="text-muted">@</span> {homeTeam}
        </div>
        <div className="text-xs font-mono text-muted">{formatGameTime(commenceTime)}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="px-4 py-2 font-normal">Outcome</th>
              {bookColumns.map((book) => (
                <th
                  key={book.slug}
                  className={`px-4 py-2 font-normal whitespace-nowrap ${
                    book.isSharp ? "text-accent" : ""
                  }`}
                >
                  {book.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {outcomeNames.map((outcomeName) => (
              <tr key={outcomeName} className="border-t border-border">
                <td className="px-4 py-2 whitespace-nowrap">{outcomeName}</td>
                {bookColumns.map((book) => {
                  const row = cell(outcomeName, book.slug);
                  return (
                    <td
                      key={book.slug}
                      className={`px-4 py-2 font-mono whitespace-nowrap ${
                        book.isSharp ? "border-x border-accent/20" : ""
                      }`}
                    >
                      {row ? (
                        <span className={row.price > 0 ? "text-accent" : "text-foreground"}>
                          {formatPrice(row.price)}
                          {row.point !== null && (
                            <span className="text-muted"> ({row.point > 0 ? `+${row.point}` : row.point})</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OddsTable({ rows }: { rows: OddsApiRow[] }) {
  const gameIds = Array.from(new Set(rows.map((r) => r.gameId)));

  const bookColumns: BookColumn[] = Array.from(
    new Map(
      rows.map((r) => [r.bookSlug, { slug: r.bookSlug, name: r.bookName, isSharp: r.isSharp }])
    ).values()
  ).sort((a, b) => Number(b.isSharp) - Number(a.isSharp));

  return (
    <div className="flex flex-col gap-4">
      {gameIds.map((gameId) => {
        const gameRows = rows.filter((r) => r.gameId === gameId);
        const first = gameRows[0];
        return (
          <GameCard
            key={gameId}
            homeTeam={first.homeTeam}
            awayTeam={first.awayTeam}
            commenceTime={first.commenceTime}
            rows={gameRows}
            bookColumns={bookColumns}
          />
        );
      })}
    </div>
  );
}
