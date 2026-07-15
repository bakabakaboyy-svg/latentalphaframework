# LAF — Latent Alpha Framework

Personal sports arbitrage, line movement tracking, and +EV detection tool. Tracks
opening lines at sharp books, detects steam moves, monitors CLV in real time, and
surfaces arbitrage opportunities across sportsbooks and prediction markets.

## Tech Stack

- **Next.js** (App Router) + TypeScript + Tailwind CSS — frontend & API routes
- **Supabase** (Postgres) — database
- **Recharts** — MOVEMENT tab charts (opening line comparison, price history)
- Prediction markets: Kalshi (via Action Network), Polymarket (direct, MLB only — see below)
- **Railway** — cron job that hits `/api/scrape` every minute
- **Vercel** — hosting, auto-deploys on push to `main`
- PWA-enabled (installable, offline app-shell fallback)

## Project Structure

```
app/                Pages and API routes (App Router)
  api/scrape/        POST — cron-secret-protected, runs the scraper, writes to Supabase
  api/scrape/manual/ POST — same scrape, no secret needed (dashboard Refresh button, local curl)
  api/odds/          GET  — returns latest odds per game/book/market
  api/movement/      GET  — opening lines + full price history + current lines for one game
  api/steam/         GET  — steam_moves in the last N hours, plus summary stats
  api/clv/           GET/POST/PUT — open bets w/ live CLV, log a bet, close a bet
components/         Reusable UI components (LinesTab, MovementTab, SteamTab, CLVTab, charts,
                    shared filters, Toast)
lib/                Supabase client, scrapers (actionNetwork, polymarket), shared scrape
                    logic, odds normalization + steam detection + CLV math (lib/utils/),
                    schema.sql, migrations/
types/              Shared TypeScript types
public/             PWA manifest, service worker, icons
```

## Data Flow

```
Action Network (live page, includes Kalshi's odds already)  ─┐
Polymarket gamma API (MLB win-markets, probabilities)        ─┼─> lib/runScrape.ts
                                                               │     (matches Polymarket games onto the
                                                               │      same row Action Network already
                                                               │      created, converts probabilities to
                                                               │      American odds, upserts games,
                                                               │      records odds_snapshots + opening_lines)
                                                               └─> Supabase (Postgres)
  -> app/api/odds/route.ts           (GET, dedupes to latest snapshot per line — LINES tab)
  -> app/api/movement/route.ts       (GET, opening + full history + current — MOVEMENT tab)
  -> components/LinesTab.tsx / MovementTab.tsx
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project

1. Create a project at [supabase.com](https://supabase.com) (free tier is enough).
2. Open the **SQL Editor** and paste in the entire contents of [`lib/schema.sql`](lib/schema.sql), then run it.
   This creates all tables (`games`, `odds_snapshots`, `opening_lines`, `steam_moves`,
   `bet_entries`, `books`, `sports`) and seeds the initial books/sports rows.
3. **If you already ran the schema in an earlier session**, `schema.sql` alone won't add
   new columns to existing tables — run any files in [`lib/migrations/`](lib/migrations)
   you haven't applied yet, in order, in the same SQL Editor:
   [`002_first_recorded_book.sql`](lib/migrations/002_first_recorded_book.sql) (Session 3),
   [`003_steam_moves_constraints.sql`](lib/migrations/003_steam_moves_constraints.sql) (Session 5),
   [`004_bet_entries_point.sql`](lib/migrations/004_bet_entries_point.sql) (Session 6).

### 3. Environment variables

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` `public` key |
| `SUPABASE_SERVICE_KEY` | Supabase → Project Settings → API → `service_role` key (**secret**, server-only) |
| `ODDS_API_KEY` | [the-odds-api.com](https://the-odds-api.com) free tier signup |
| `CRON_SECRET` | Any random string you generate yourself, e.g. `openssl rand -hex 32` |

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Test the scraper

Easiest way: open [http://localhost:3000](http://localhost:3000) and click **REFRESH** on
the LINES tab. That calls `POST /api/scrape/manual`, which needs no secret while running
locally, pulls live odds from Action Network, writes them to Supabase, then the dashboard
re-fetches automatically.

You can also trigger it directly from a terminal:

```bash
curl -X POST http://localhost:3000/api/scrape/manual
```

Or exercise the cron-secret-protected route the same way Railway eventually will:

```bash
curl -X POST http://localhost:3000/api/scrape -H "x-cron-secret: <your CRON_SECRET>"
```

You should see `[actionNetwork]` and `[scrape]` console logs in the terminal running
`npm run dev` showing games being fetched and written to Supabase.

> **Note:** `/api/scrape/manual` skips the secret check only when `NODE_ENV !== "production"`.
> Once deployed, it instead requires the request to come from the dashboard itself
> (checked via the `Sec-Fetch-Site` header) — see the comment in
> [`app/api/scrape/manual/route.ts`](app/api/scrape/manual/route.ts) for why: it's a public
> POST endpoint that scrapes an external site and writes to your database, so it shouldn't
> be left completely open once the app has a real public URL.

## Deployment

- **Vercel**: connect this GitHub repo, add the same environment variables in
  Project Settings → Environment Variables, deploy.
- **Automatic scraping** (so steam detection and line movement keep updating without you
  clicking REFRESH): something needs to call `POST /api/scrape` with header
  `x-cron-secret: <CRON_SECRET>` on a schedule. This needs an account/dashboard on your
  end to set up — a few options, roughly cheapest-to-easiest:
  - **Railway** cron job hitting `POST https://<your-vercel-domain>/api/scrape` every minute.
  - **cron-job.org** (free) — same idea, no infra to manage.
  - **Vercel Cron** (`vercel.json`) — built-in, but the Hobby (free) plan only allows
    once-per-day schedules; per-minute scraping needs a paid plan.
  - **GitHub Actions** on a `schedule` trigger, calling the endpoint with `curl`.
  Whichever you pick, the endpoint itself (`/api/scrape`) is already built and working —
  this is just wiring something up to call it regularly.

## Troubleshooting

- **"No data yet" on the LINES tab** — click REFRESH. If it stays empty, check that
  `/api/scrape/manual` (or `/api/scrape`) returned `"success": true` — read the JSON
  response or the terminal logs for the specific error.
- **Errors mentioning Supabase / "not set"** — check `.env.local` has real values (not
  placeholders) for `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
  `SUPABASE_SERVICE_KEY`, and that you restarted `npm run dev` after editing it (env vars
  only load on startup). `NEXT_PUBLIC_SUPABASE_URL` must be the **API URL**
  (`https://<project-ref>.supabase.co`), not the dashboard URL.
- **TENNIS or CS2 filters always show no data** — expected. MLB, WNBA, and Soccer are
  scraped (same Action Network page shape); Tennis splits into separate ATP/WTA pages
  with a different data shape, and Action Network has no CS2/esports coverage at all.
  Both need a different approach in a future session, not just a tweak to the current scraper.
- **MOVEMENT tab's Pinnacle/Circa rows always show "—" / no green bars** — expected.
  Those are the two sharp books, but Action Network's default (US/NJ) odds pages don't
  include them — they're region-gated. The sharp-book highlighting is wired up and will
  light up automatically once a Pinnacle/Circa-specific fetch is added.
- **Deployed on Vercel but still errors** — Vercel's environment variables are separate
  from your local `.env.local`; both need to be filled in independently, and Vercel needs
  a redeploy after you change them (Deployments tab → Redeploy).

## MOVEMENT Tab — Understanding Opening Lines

The MOVEMENT tab tracks which book posted the opening line first (or, more precisely,
which book we *treat* as the reference open — see the caveat below), then shows how
other books followed or moved differently since.

- **Opening line comparison** (bar chart) — each book/outcome's price the moment it was
  first recorded for this game. Sharp books (Pinnacle, Circa) are highlighted green.
- **Price history over time** (line chart) — every recorded snapshot since, one line per
  book/outcome, so you can see the shape of the move rather than just before/after.
- **Line movement details** (table) — opening vs. current price per book/outcome, with
  the change and direction at a glance.

**Caveat on "first_recorded_book":** Action Network gives us one snapshot of every book
at once per scrape, not a live feed, so we can't detect which book *genuinely* posted a
line first in real time. `first_recorded_book` (and the tab's "Opened: ..." subheader) is
a display choice — it prefers a sharp book when one is present, otherwise falls back to
whichever book sorts first alphabetically. It's set once, the first time an outcome opens,
and never changes after that.

### `GET /api/movement`

Query params: `game_id` (required), `market_type` (optional, defaults to `h2h`).

Returns opening lines, full price history (last 2 hours, or everything available for a
newer game), current lines, and a `referenceOpens` array (one entry per outcome) for
everything currently recorded for that game + market. See
[`types/odds.ts`](types/odds.ts) (`MovementResponse`) for the exact shape.

## Prediction Markets

LAF tracks Kalshi and Polymarket for sports events, alongside sportsbooks.

- **Kalshi** odds arrive as part of the regular Action Network scrape — Action Network
  already lists Kalshi as a book on its odds pages and reports its contracts in American
  odds format directly, so no separate Kalshi integration was needed (a dedicated Kalshi
  scraper was scoped for this session but turned out to be redundant — see
  [`lib/scrapers/actionNetwork.ts`](lib/scrapers/actionNetwork.ts) for the up-to-date list
  of books it recognizes).
- **Polymarket** is scraped directly ([`lib/scrapers/polymarket.ts`](lib/scrapers/polymarket.ts))
  via their public `gamma-api.polymarket.com` API — no auth required. Currently **MLB
  only**: Polymarket has genuine daily per-game "win" markets for MLB, but only
  season-long futures (Champion, MVP, etc.) for WNBA/Soccer, which don't fit our per-game
  schema. **Polymarket is geo-restricted for US users** — the API itself is publicly
  reachable, but check Polymarket's terms before relying on this for anything beyond
  personal research.
- Kalshi and Polymarket odds are displayed as American odds for easy comparison with
  sportsbooks (`lib/utils/normalizeOdds.ts` converts each market's probability using the
  standard fair-odds formula), but the underlying markets are probability-based — a "price"
  from either one is really "the market currently thinks this has an X% chance," not a
  bookmaker's quote. The MOVEMENT tab highlights both in purple and notes this under the
  price history chart whenever a prediction market is present in the data.
- Because Polymarket and Action Network report the same real-world game under different
  IDs, `lib/runScrape.ts` matches Polymarket games onto the existing Action Network game
  (same sport + team names + start time within 30 minutes) so all books — sportsbooks and
  prediction markets alike — land on one row instead of splitting into duplicate games.
- Docs: [Kalshi API docs](https://docs.kalshi.com/) · [Polymarket](https://polymarket.com/)

## STEAM Tab — Sharp Action Detection

Steam moves happen when sharp bettors place large enough wagers that books adjust their
lines quickly to rebalance — and other books, watching each other, often follow within
minutes. Several books moving the same direction in a short window is read as a signal
that real money (not just public betting volume) is behind the move. "Steam chasing" —
following a detected move quickly — is a popular approach among sharp bettors, though
how well it works depends heavily on execution speed and position sizing; it isn't a
guaranteed edge.

**Detection algorithm** ([`lib/utils/steamDetection.ts`](lib/utils/steamDetection.ts)):
for every (game, market, outcome), compare each book's two most recent
`odds_snapshots`. If 3 or more books moved in the *same* direction within 5 minutes of
each other, it's flagged as steam. The book treated as the "trigger" prefers a sharp book
among the movers, else whichever book moved the most — this is a display choice, not a
detected "who moved first" signal, for the same reason noted in the MOVEMENT tab section
above: our sources give us periodic snapshots, not a real-time feed, so if several books'
prices changed within the same scrape we can't know their true order.

Runs automatically as part of every scrape (`lib/runScrape.ts`) and writes to the
`steam_moves` table (present since the Session 1 schema, unused until now).

### `GET /api/steam`

Query params: `sport`, `market_type`, `hours` (default 24) — all optional.

Returns `steamMoves` (newest first) plus `totalSteamMoves`, `mostActiveGame`, and
`mostCommonTriggerBook` for the requested window. See [`types/odds.ts`](types/odds.ts)
(`SteamResponse`) for the exact shape.

### STEAM tab UI

- **LIVE MODE** (default) — cards for steam moves detected in the last 60 minutes.
- **HISTORY MODE** — condensed list covering the last 24 hours.
- **Steam Move Frequency** chart — hourly bar chart of detection counts over the last 24h.
- Auto-refreshes every minute while the tab/browser window is visible (pauses when
  backgrounded, via the Page Visibility API, and refetches immediately on return).
- The nav bar's 🔥 icon turns red when any steam has been detected in the last 30 minutes,
  independent of which tab or sport filter is currently open.

Note: how *often* new steam gets detected depends entirely on how often `/api/scrape`
runs — see "Automatic scraping" under Deployment above. Without a cron calling it
regularly, steam moves only get recorded when you manually click REFRESH.

## CLV Tab — Tracking Closing Line Value

The CLV tab is where you log your bets and watch their closing line value in real time.
CLV% tells you whether the price you got was better or worse than where the market moved
afterward — positive CLV means you beat the closing line, which correlates with
long-run profitability far more reliably than short-term win/loss record does.

**Formula** (`lib/utils/clv.ts`): `((currentOrClosingPrice - entryPrice) / |entryPrice|) * 100`

```
entry -110, current -108  ->  +1.82%
entry +150, current +160  ->  +6.67%
entry -110, current -115  ->  -4.55%
```

This is a simplified "cents" comparison, not a full no-vig/implied-probability CLV
calculation — good enough for tracking whether a line moved your way, but treat large
swings between very different price ranges (e.g. -110 vs. +400) with some caution, since
American odds aren't linear.

For **open** bets, CURRENT PRICE and CLV% are computed live on every fetch against the
latest matching `odds_snapshots` row — nothing is cached, so they only update as often as
`/api/scrape` runs (see "Automatic scraping" under Deployment). For **closed** bets,
CLV% is calculated once from your entered closing price and stored permanently.

**Threshold filters** (ALL / 1%+ / 2%+ / 3%+ / 4%+) let you focus on your highest-edge
bets — e.g. click "2%+" to hide everything that hasn't beaten the closing line by at
least 2%.

**Best practice:** log bets immediately after placing them. CLV is only meaningful if the
entry price you record is the price you actually got — logging late (after the line's
already moved) understates or overstates your real edge.

**Not yet built:** actual win/loss grading. The ACTION button marks a bet "closed" with a
closing price (for CLV purposes only) — it doesn't record whether the bet won. The CLV
Statistics card is upfront about this rather than showing a fabricated win rate.

### `GET/POST/PUT /api/clv`

- `GET ?status=open&sport=mlb&market_type=h2h` — open (or closed/graded) bets with
  live-computed current price/CLV, plus game/book context.
- `POST` — log a new bet. Body: `{ gameId, marketType, outcomeName, point, bookSlug,
  entryPrice, stake, entryTime }` (`point`/`stake`/`entryTime` nullable).
- `PUT` — close a bet. Body: `{ betId, status, closingPrice }` — `clv_percentage` is
  always computed server-side from `entry_price` + `closingPrice`, never trusted from
  the client.

See [`types/odds.ts`](types/odds.ts) (`BetEntry`, `CLVResponse`, `LogBetRequest`,
`UpdateBetRequest`) for exact shapes.

## Screenshot

_Dashboard screenshot goes here._

_MOVEMENT tab screenshot goes here._

_STEAM tab screenshot goes here._

_CLV tab screenshot goes here._

## Roadmap

See [`claude.md`](claude.md) for the full phased build plan (line movement tracking,
steam detection, CLV, arbitrage, prediction markets).
