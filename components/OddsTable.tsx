import type { GameWithOdds } from "@/types/odds";

export type Timezone = "EST" | "CST" | "PST";

const TIMEZONE_IANA: Record<Timezone, string> = {
  EST: "America/New_York",
  CST: "America/Chicago",
  PST: "America/Los_Angeles",
};

// Fixed column order/set. Pinnacle and Circa aren't here — Action Network
// doesn't have live data for either (region-gated), so as of Session 4
// they're replaced with the two prediction markets, which do have real data.
const BOOK_COLUMNS = [
  { slug: "fanduel", name: "FanDuel", isSharp: false, isPredictionMarket: false },
  { slug: "draftkings", name: "DraftKings", isSharp: false, isPredictionMarket: false },
  { slug: "betmgm", name: "BetMGM", isSharp: false, isPredictionMarket: false },
  { slug: "kalshi", name: "Kalshi", isSharp: false, isPredictionMarket: true },
  { slug: "polymarket", name: "Polymarket", isSharp: false, isPredictionMarket: true },
] as const;

const PREDICTION_MARKET_COLOR = "#8b5cf6";

function formatGameTime(iso: string, timezone: Timezone): string {
  const formatted = new Date(iso).toLocaleString("en-US", {
    timeZone: TIMEZONE_IANA[timezone],
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatted} ${timezone}`;
}

function formatPrice(price: number): string {
  return price > 0 ? `+${price}` : `${price}`;
}

function outcomeOrder(outcomeName: string, homeTeam: string, awayTeam: string): number {
  if (outcomeName === awayTeam) return 0;
  if (outcomeName === homeTeam) return 1;
  if (outcomeName === "Over") return 0;
  if (outcomeName === "Under") return 1;
  return 2;
}

function GameCard({ game, timezone }: { game: GameWithOdds; timezone: Timezone }) {
  const { homeTeam, awayTeam, odds } = game;

  const outcomeNames = Array.from(new Set(odds.map((o) => o.outcomeName))).sort(
    (a, b) => outcomeOrder(a, homeTeam, awayTeam) - outcomeOrder(b, homeTeam, awayTeam)
  );

  const cell = (outcomeName: string, bookSlug: string) =>
    odds.find((o) => o.outcomeName === outcomeName && o.bookSlug === bookSlug);

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="text-sm font-medium">
          {homeTeam} <span className="text-muted">@</span> {awayTeam}
        </div>
        <div className="flex items-center gap-2">
          {game.status === "live" && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-white bg-danger">
              LIVE
            </span>
          )}
          <span className="text-xs font-mono text-muted">{formatGameTime(game.commenceTime, timezone)}</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="px-4 py-2 font-mono uppercase text-muted text-[11px] font-normal">
                Outcome
              </th>
              {BOOK_COLUMNS.map((book) => (
                <th
                  key={book.slug}
                  title={
                    book.isPredictionMarket
                      ? `${book.name} is a prediction market — price shown is a probability converted to American odds`
                      : book.isSharp
                        ? `${book.name} is a sharp book — watch for line movement`
                        : undefined
                  }
                  style={book.isPredictionMarket ? { color: PREDICTION_MARKET_COLOR, borderLeftColor: PREDICTION_MARKET_COLOR } : undefined}
                  className={`px-4 py-2 font-mono uppercase text-[11px] font-normal whitespace-nowrap ${
                    book.isPredictionMarket
                      ? "border-l-2 cursor-help"
                      : book.isSharp
                        ? "text-accent border-l-2 border-accent cursor-help"
                        : "text-muted"
                  }`}
                >
                  {book.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {outcomeNames.map((outcomeName, i) => (
              <tr
                key={outcomeName}
                className={`fade-in-row border-t border-border hover:bg-[#1a1a1a] transition-colors ${
                  i % 2 === 0 ? "bg-surface" : "bg-[#0f0f0f]"
                }`}
              >
                <td className="px-4 py-2 whitespace-nowrap text-foreground">{outcomeName}</td>
                {BOOK_COLUMNS.map((book) => {
                  const line = cell(outcomeName, book.slug);
                  return (
                    <td
                      key={book.slug}
                      style={book.isPredictionMarket ? { borderLeftColor: `${PREDICTION_MARKET_COLOR}4d` } : undefined}
                      className={`px-4 py-2 font-mono whitespace-nowrap ${
                        book.isPredictionMarket ? "border-l-2" : book.isSharp ? "border-l-2 border-accent/30" : ""
                      }`}
                    >
                      {line ? (
                        <span className={book.isPredictionMarket ? "" : line.price > 0 ? "text-accent" : "text-foreground"} style={book.isPredictionMarket ? { color: PREDICTION_MARKET_COLOR } : undefined}>
                          {formatPrice(line.price)}
                          {line.point !== null && (
                            <span className="text-muted"> ({line.point > 0 ? `+${line.point}` : line.point})</span>
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

export function OddsTable({ games, timezone }: { games: GameWithOdds[]; timezone: Timezone }) {
  return (
    <div className="flex flex-col gap-4">
      {games.map((game) => (
        <GameCard key={game.id} game={game} timezone={timezone} />
      ))}
    </div>
  );
}
