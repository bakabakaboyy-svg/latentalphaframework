# LAF — Latent Alpha Framework

Personal sports arbitrage, line movement tracking, and +EV detection tool. Tracks
opening lines at sharp books, detects steam moves, monitors CLV in real time, and
surfaces arbitrage opportunities across sportsbooks and prediction markets.

## Tech Stack

- **Next.js** (App Router) + TypeScript + Tailwind CSS — frontend & API routes
- **Supabase** (Postgres) — database
- **Recharts** — MOVEMENT tab charts (opening line comparison, price history)
- Prediction markets: Kalshi (via Action Network), Polymarket (direct, MLB only — see below)
- **GitHub Actions** — scheduled workflow that hits `/api/scrape` every 5 minutes (see
  [`.github/workflows/scrape-cron.yml`](.github/workflows/scrape-cron.yml))
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
  api/arb/           GET  — live arb opportunities computed from current odds, plus 24h stats
components/         Reusable UI components (LinesTab, MovementTab, SteamTab, CLVTab, ArbTab,
                    charts, shared filters, Toast)
lib/                Supabase client, scrapers (actionNetwork, polymarket), shared scrape
                    logic, shared "latest odds per game" loader (lib/odds.ts), odds
                    normalization + steam/arb detection + CLV/EV math (lib/utils/),
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
   [`004_bet_entries_point.sql`](lib/migrations/004_bet_entries_point.sql) (Session 6),
   [`005_arbitrage_opportunities.sql`](lib/migrations/005_arbitrage_opportunities.sql) (Session 7),
   [`006_quant_engine.sql`](lib/migrations/006_quant_engine.sql) (Session 8 — creates the `qe_*`
   tables read by the QUANT tab; written to by the separate `quant_engine` Python repo, not by LAF).

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

Or exercise the cron-secret-protected route the same way the scheduled GitHub Actions
workflow does in production:

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
  clicking REFRESH): [`.github/workflows/scrape-cron.yml`](.github/workflows/scrape-cron.yml)
  calls `POST /api/scrape` with header `x-cron-secret: <CRON_SECRET>` every 5 minutes —
  GitHub Actions' practical floor for scheduled workflows (it doesn't reliably honor
  shorter intervals). This replaced an originally-planned Railway cron job that was never
  actually deployed; production went hours at a time without a fresh scrape before this
  was wired up.
  - Requires a `CRON_SECRET` **repository secret** (Settings → Secrets and variables →
    Actions → New repository secret) matching whatever `CRON_SECRET` is set to in Vercel's
    Environment Variables — these are two separate places the same value has to live.
  - For true 1-minute cadence instead of 5, either upgrade to **Vercel Pro** ($20/mo, then
    use a `vercel.json` Cron Job instead of this workflow) or point a free service like
    **cron-job.org** at the same endpoint (GitHub Actions can't reliably go below 5 min).

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
  odds format directly, so no separate Kalshi scraper was needed for game/team matching
  (see [`lib/scrapers/actionNetwork.ts`](lib/scrapers/actionNetwork.ts) for the up-to-date
  list of books it recognizes). That reported price is Kalshi's raw ask-implied
  probability with **Kalshi's own taker fee not applied** — confirmed by reconstructing
  the implied probability from Action Network's number and comparing against Kalshi's
  real fee schedule (`fee = round_up(0.07 × C × P × (1-P))`, from their CFTC-filed fee
  schedule): applying it lands exactly on Kalshi's own displayed price. `applyKalshiFee()`
  in `lib/scrapers/actionNetwork.ts` reconstructs the implied ask probability from Action
  Network's reported odds and adds this fee back in before storing the price — same
  "real executable cost, not the theoretical one" principle as the Polymarket fix below.
- **Polymarket** is scraped directly ([`lib/scrapers/polymarket.ts`](lib/scrapers/polymarket.ts))
  via their public `gamma-api.polymarket.com` API — no auth required. Currently **MLB
  only**: Polymarket has genuine daily per-game "win" markets for MLB, but only
  season-long futures (Champion, MVP, etc.) for WNBA/Soccer, which don't fit our per-game
  schema. **Polymarket is geo-restricted for US users** — the API itself is publicly
  reachable, but check Polymarket's terms before relying on this for anything beyond
  personal research.
- Kalshi and Polymarket odds are displayed as American odds for easy comparison with
  sportsbooks. Polymarket's price is the **real executable cost to buy that side right
  now** — the live order-book ask, plus Polymarket's taker fee (`fee = shares × feeRate ×
  p × (1-p)`, 5% for sports as of July 2026, per
  [docs.polymarket.com/trading/fees](https://docs.polymarket.com/trading/fees)) — not the
  fair-value midpoint (`outcomePrices`). The midpoint looks "juiceless" because it's
  exactly `(bestBid + bestAsk) / 2` by construction; it's the right number for estimating
  true probability, but the wrong one for "what would I actually pay to place this bet,"
  which is what this app is for. See `lib/scrapers/polymarket.ts` for the exact math, and
  `lib/utils/normalizeOdds.ts` for the probability → American odds conversion itself (that
  part IS the standard fair-odds formula — it's the input probability that changed, not
  the conversion). The MOVEMENT tab highlights both prediction markets in purple.
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

## ARB Tab — True Arbitrage Detection

True arbitrage is a guaranteed profit opportunity: bet both (or all) sides of a market
at different books, and you profit regardless of outcome. It exists whenever the best
available prices across books are collectively "under 100%" once vig is stripped out —
the books are, between them, offering a better deal than either one intends on its own.

**No-vig math** (`lib/utils/noVigCalculator.ts`):

1. Convert each side's American odds to an implied probability (`americanToImpliedProb`)
   — this still includes the book's vig.
2. Sum the best available probability for every outcome in the market.
3. If that sum is **less than 1.0**, an arb exists — `arb_percentage = (1 - sum) * 100`.
4. Stake size per leg is proportional to that leg's raw implied probability
   (`stake_i = prob_i / sum(probs)`), which is what actually locks in equal profit
   across every outcome given the real prices offered — not the vig-removed "true"
   probability, which sums to 1 by construction and would misprice the hedge.

```
Yankees -120 at FanDuel    (prob 0.5455)
Red Sox +130 at DraftKings (prob 0.4348)
Sum: 0.9803  ->  1.97% guaranteed profit
Stake split: 55.65% on Yankees, 44.35% on Red Sox
```

**Two-way markets** (moneyline for most sports, spreads, totals) compare the best two
prices for a line. **Three-way markets** — soccer moneyline's Home/Draw/Away — extend
the same math to three legs (`detectThreeWayArb`), since Draw is a genuinely separate,
independently-priced outcome there, not a synthetic third option.

Live arb cards on this tab are **computed fresh from current odds on every request** —
the same "don't trust a stale cache" philosophy as the CLV tab's live-computed CURRENT
PRICE — since a real arb can close in seconds as soon as one book moves. The
`arbitrage_opportunities` table is a historical log the scraper appends to on every run
(same pattern as `steam_moves`), used only to power the "Arbitrage Activity (Last 24
Hours)" stats card, not the live list itself.

**Why arbs close quickly:** once detected, sharp bettors (and the books' own risk
systems) exploit or correct them within seconds to minutes, moving lines to eliminate the
edge. Arbitrage opportunities are rare, small (often under 2%), and short-lived — this
tab is about catching them fast, not finding a standing edge.

### `GET /api/arb`

- `?sport=mlb&market=h2h&minArb=1.0` — sport/market filters plus a minimum arb%
  threshold (server-side; the tab itself fetches with `minArb=0` and filters client-side
  via the threshold slider for instant response).
- Returns `arbitrageOpportunities` (each with 2 or 3 `legs`, sorted by `arbPercentage`
  descending), `totalArbsAvailable`, `highestArbPercentage`, and a `stats` block covering
  the last 24 hours.

See [`types/odds.ts`](types/odds.ts) (`ArbOpportunity`, `ArbLeg`, `ArbStats`,
`ArbResponse`) for exact shapes.

**LOG AS HEDGE** logs both (or all) legs of an arb straight to the CLV tab as separate
bet entries, split proportionally across whatever total stake you enter — so a hedge you
actually place shows up in your CLV history like any other bet.

## Screenshot

_Dashboard screenshot goes here._

_MOVEMENT tab screenshot goes here._

_STEAM tab screenshot goes here._

_CLV tab screenshot goes here._

_ARB tab screenshot goes here._

## Roadmap

See [`claude.md`](claude.md) for the full phased build plan (line movement tracking,
steam detection, CLV, arbitrage, prediction markets).
