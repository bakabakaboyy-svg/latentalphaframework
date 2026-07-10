# LAF — Latent Alpha Framework

Personal sports arbitrage, line movement tracking, and +EV detection tool. Tracks
opening lines at sharp books, detects steam moves, monitors CLV in real time, and
surfaces arbitrage opportunities across sportsbooks and prediction markets.

## Tech Stack

- **Next.js** (App Router) + TypeScript + Tailwind CSS — frontend & API routes
- **Supabase** (Postgres) — database
- **Railway** — cron job that hits `/api/scrape` every minute
- **Vercel** — hosting, auto-deploys on push to `main`
- PWA-enabled (installable, offline app-shell fallback)

## Project Structure

```
app/                Pages and API routes (App Router)
  api/scrape/        POST — cron-secret-protected, runs the scraper, writes to Supabase
  api/scrape/manual/ POST — same scrape, no secret needed (dashboard Refresh button, local curl)
  api/odds/          GET  — returns latest odds per game/book/market
components/         Reusable UI components
lib/                Supabase client, scrapers, shared scrape logic, schema.sql
types/              Shared TypeScript types
public/             PWA manifest, service worker, icons
```

## Data Flow

```
Action Network (live page)
  -> lib/scrapers/actionNetwork.ts   (reads the embedded __NEXT_DATA__ JSON)
  -> lib/runScrape.ts                (upserts games, records odds_snapshots + opening_lines)
  -> Supabase (Postgres)
  -> app/api/odds/route.ts           (GET, dedupes to latest snapshot per line)
  -> components/LinesTab.tsx         (fetches on load; REFRESH button re-scrapes then re-fetches)
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
- **Railway**: cron job that calls `POST https://<your-vercel-domain>/api/scrape`
  with header `x-cron-secret: <CRON_SECRET>` every minute — set up in a later session.

## Troubleshooting

- **"No data yet" on the LINES tab** — click REFRESH. If it stays empty, check that
  `/api/scrape/manual` (or `/api/scrape`) returned `"success": true` — read the JSON
  response or the terminal logs for the specific error.
- **Errors mentioning Supabase / "not set"** — check `.env.local` has real values (not
  placeholders) for `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
  `SUPABASE_SERVICE_KEY`, and that you restarted `npm run dev` after editing it (env vars
  only load on startup). `NEXT_PUBLIC_SUPABASE_URL` must be the **API URL**
  (`https://<project-ref>.supabase.co`), not the dashboard URL.
- **A sport filter (WNBA/Tennis/Soccer/CS2) always shows no data** — expected for now;
  the scraper currently only covers MLB. Other sports need their own scraper functions
  in a future session.
- **Deployed on Vercel but still errors** — Vercel's environment variables are separate
  from your local `.env.local`; both need to be filled in independently, and Vercel needs
  a redeploy after you change them (Deployments tab → Redeploy).

## Screenshot

_Dashboard screenshot goes here._

## Roadmap

See [`claude.md`](claude.md) for the full phased build plan (line movement tracking,
steam detection, CLV, arbitrage, prediction markets).
