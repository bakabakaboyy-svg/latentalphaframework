import type { GameOdds, OddsLine, BookSlug, MarketType, SportSlug } from "@/types/odds";
import { americanToImpliedProb } from "@/lib/utils/noVigCalculator";
import { convertProbabilityToAmericanOdds } from "@/lib/utils/normalizeOdds";

// Action Network is a Next.js site — instead of parsing rendered HTML, we pull
// the JSON it embeds in a <script id="__NEXT_DATA__"> tag on every page. This
// is the same data their own React components render from, so it's far more
// reliable than scraping DOM text (which changes with every CSS refactor).
//
// NOTE: this is an undocumented, unofficial data shape. Action Network can
// change it at any time without notice — if this scraper starts returning
// zero games for a sport, open that sport's odds URL in a browser and
// re-inspect the __NEXT_DATA__ payload (search for "scoreboardResponse").

// Sports whose Action Network odds page uses the flat `games[]` shape this
// scraper understands. Tennis (ATP/WTA) is NOT here: its page nests matches
// under `competitions[]` instead of a flat `games[]` array, a genuinely
// different shape this scraper doesn't parse yet. CS2 isn't here because
// Action Network has no esports coverage at all — no nav entry, no odds page,
// nothing to scrape. Both would need a different data source, not just a
// tweak to this file.
const SPORT_PATHS: Partial<Record<SportSlug, string>> = {
  mlb: "mlb/odds",
  wnba: "wnba/odds",
  soccer: "soccer/odds",
};

export const SUPPORTED_SPORTS = Object.keys(SPORT_PATHS) as SportSlug[];

// Action Network's `parent_name` per book, lowercased, mapped to our slugs.
// Pinnacle and Circa are sharp books used for opening-line tracking (Phase 2)
// but are NOT listed on Action Network's default US odds page — they only
// show up on region-specific pages (e.g. Nevada for Circa). Left here so the
// mapping is ready once we wire up a Circa/Pinnacle-specific fetch.
const BOOK_NAME_TO_SLUG: Record<string, BookSlug> = {
  fanduel: "fanduel",
  draftkings: "draftkings",
  betmgm: "betmgm",
  pinnacle: "pinnacle",
  circa: "circa",
  kalshi: "kalshi",
};

// Kalshi's real per-contract taker fee (fee = round_up(0.07 × C × P × (1-P)),
// confirmed against their official CFTC-filed fee schedule) is charged
// whenever an order matches immediately against the book — exactly what
// "buy this side right now" means. Action Network reports Kalshi's raw
// ask-implied price with this fee NOT applied (unlike FanDuel/DraftKings/
// BetMGM, whose reported odds are the sportsbook's own real, already-vigged
// quote), so it understates the true cost to actually place the trade. We
// reconstruct the implied ask probability from Action Network's reported
// American odds and add Kalshi's fee back in ourselves — confirmed against
// a live discrepancy report: Action Network showed +127, Kalshi's own site
// showed +118 for the same contract, and this transform reproduces +118
// exactly. Continuous (unrounded) rate, same modeling choice as the
// Polymarket scraper's fee handling, since the coarse per-contract rounding
// only matters at trade sizes of a few contracts.
const KALSHI_TAKER_FEE_RATE = 0.07;

function applyKalshiFee(americanOdds: number): number {
  const askProbability = americanToImpliedProb(americanOdds);
  const allInProbability = askProbability + KALSHI_TAKER_FEE_RATE * askProbability * (1 - askProbability);
  return convertProbabilityToAmericanOdds(allInProbability);
}

interface ActionNetworkTeam {
  id: number;
  full_name: string;
  short_name: string;
}

interface ActionNetworkOutcome {
  book_id: number;
  type: string; // 'moneyline' | 'spread' | 'total' | ...(prop types we ignore)
  side: string; // 'home' | 'away' | 'draw' | 'over' | 'under'
  team_id?: number;
  odds: number;
  value: number;
  is_live?: boolean;
}

interface ActionNetworkGame {
  id: number;
  status: string;
  start_time: string;
  home_team_id: number;
  away_team_id: number;
  teams: ActionNetworkTeam[];
  markets?: Record<
    string,
    { event?: Record<string, ActionNetworkOutcome[]> }
  >;
}

interface ActionNetworkBook {
  id: number;
  parent_name: string | null;
}

function mapStatus(status: string): "upcoming" | "live" | "final" {
  const s = status.toLowerCase();
  if (s.includes("live") || s.includes("progress")) return "live";
  if (s.includes("final") || s.includes("complete")) return "final";
  return "upcoming";
}

interface ActionNetworkNextData {
  props?: {
    pageProps?: {
      scoreboardResponse?: { games?: ActionNetworkGame[] };
      allBooks?: Record<string, ActionNetworkBook>;
    };
  };
}

function extractNextData(html: string): ActionNetworkNextData {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) {
    throw new Error(
      "Could not find __NEXT_DATA__ script tag — Action Network may have changed their page structure."
    );
  }
  return JSON.parse(match[1]);
}

function buildBookSlugMap(
  allBooks: Record<string, ActionNetworkBook>
): Map<number, BookSlug> {
  const map = new Map<number, BookSlug>();
  for (const book of Object.values(allBooks)) {
    const parentName = (book.parent_name || "").toLowerCase();
    const slug = BOOK_NAME_TO_SLUG[parentName];
    if (slug) map.set(book.id, slug);
  }
  return map;
}

function outcomesToLines(
  outcomes: ActionNetworkOutcome[],
  marketType: MarketType,
  homeTeam: string,
  awayTeam: string,
  homeTeamId: number
): OddsLine[] {
  const lines: OddsLine[] = [];

  for (const outcome of outcomes) {
    // Action Network sometimes lists both the pregame line and a live/in-play
    // line for the same side under the same market once a game is close to
    // (or at) start time — same side/team_id, different market_id, flagged
    // is_live: true. Confirmed via a real corrupted read: the All-Star Game's
    // DraftKings moneyline briefly carried both, and without this filter we'd
    // record whichever happened to be later in the array as if it were the
    // pregame price. LAF tracks pregame line movement, not live betting, so
    // live entries are skipped entirely rather than merged or preferred.
    if (outcome.is_live) continue;

    let outcomeName: string;
    let point: number | null = null;

    if (outcome.side === "draw") {
      // 3-way soccer moneyline — draw has no team_id, so it needs its own case
      // rather than falling through to the home/away team-name logic below.
      outcomeName = "Draw";
    } else if (marketType === "totals") {
      outcomeName = outcome.side === "over" ? "Over" : "Under";
      point = outcome.value;
    } else {
      const isHome = outcome.team_id
        ? outcome.team_id === homeTeamId
        : outcome.side === "home";
      outcomeName = isHome ? homeTeam : awayTeam;
      if (marketType === "spreads") point = outcome.value;
    }

    lines.push({
      bookSlug: null as unknown as BookSlug, // filled in by caller, which knows the book_id
      marketType,
      outcomeName,
      price: outcome.odds,
      point,
    });
  }

  return lines;
}

// Fetches live odds for one sport from Action Network and normalizes them
// into our GameOdds shape. Covers moneyline (h2h), spread, and total markets
// for whichever of FanDuel/DraftKings/BetMGM/Kalshi Action Network is showing
// for the requesting IP's region (typically NJ).
export async function scrapeActionNetworkSport(sportSlug: SportSlug): Promise<GameOdds[]> {
  const path = SPORT_PATHS[sportSlug];
  if (!path) {
    throw new Error(
      `scrapeActionNetworkSport: "${sportSlug}" is not supported (only ${SUPPORTED_SPORTS.join(", ")} are).`
    );
  }
  const url = `https://www.actionnetwork.com/${path}`;

  console.log(`[actionNetwork:${sportSlug}] Fetching`, url);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `[actionNetwork:${sportSlug}] Fetch failed: ${response.status} ${response.statusText}`
    );
  }

  console.log(`[actionNetwork:${sportSlug}] Page fetched, extracting embedded JSON...`);
  const html = await response.text();
  const nextData = extractNextData(html);

  const pageProps = nextData?.props?.pageProps;
  const games: ActionNetworkGame[] = pageProps?.scoreboardResponse?.games ?? [];
  const allBooks: Record<string, ActionNetworkBook> = pageProps?.allBooks ?? {};

  if (games.length === 0) {
    console.log(`[actionNetwork:${sportSlug}] No games found in response.`);
    return [];
  }

  const bookSlugMap = buildBookSlugMap(allBooks);
  const bookNames = Array.from(new Set(Object.values(allBooks).map((b) => b.parent_name ?? "(unnamed)")));
  console.log(`[actionNetwork:${sportSlug}] Books found on page:`, bookNames);
  console.log(
    `[actionNetwork:${sportSlug}] Found ${games.length} games, ${bookSlugMap.size} recognized books.`
  );

  const results: GameOdds[] = [];

  for (const game of games) {
    const homeTeam = game.teams.find((t) => t.id === game.home_team_id);
    const awayTeam = game.teams.find((t) => t.id === game.away_team_id);

    if (!homeTeam || !awayTeam) {
      console.log(`[actionNetwork:${sportSlug}] Skipping game ${game.id} — missing team data.`);
      continue;
    }

    const lines: OddsLine[] = [];

    for (const [bookIdStr, market] of Object.entries(game.markets ?? {})) {
      const bookSlug = bookSlugMap.get(Number(bookIdStr));
      if (!bookSlug) continue; // not one of the books we care about

      const event = market.event ?? {};
      const marketGroups: [string, MarketType][] = [
        ["moneyline", "h2h"],
        ["spread", "spreads"],
        ["total", "totals"],
      ];

      for (const [anKey, ourMarketType] of marketGroups) {
        const outcomes = event[anKey];
        if (!outcomes) continue;

        const outcomeLines = outcomesToLines(
          outcomes,
          ourMarketType,
          homeTeam.full_name,
          awayTeam.full_name,
          game.home_team_id
        );
        for (const line of outcomeLines) {
          const price = bookSlug === "kalshi" ? applyKalshiFee(line.price) : line.price;
          lines.push({ ...line, bookSlug, price });
        }
      }
    }

    results.push({
      externalId: `an-${sportSlug}-${game.id}`,
      sportSlug,
      homeTeam: homeTeam.full_name,
      awayTeam: awayTeam.full_name,
      commenceTime: game.start_time,
      status: mapStatus(game.status),
      lines,
    });

    console.log(
      `[actionNetwork:${sportSlug}] ${awayTeam.full_name} @ ${homeTeam.full_name}: ${lines.length} lines across ${new Set(
        lines.map((l) => l.bookSlug)
      ).size} books.`
    );
  }

  console.log(`[actionNetwork:${sportSlug}] Done. ${results.length} games parsed.`);
  return results;
}
