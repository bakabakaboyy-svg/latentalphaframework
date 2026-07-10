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
  api/scrape/        POST — runs the Action Network scraper, writes to Supabase
  api/odds/          GET  — returns latest odds per game/book/market
components/         Reusable UI components
lib/                Supabase client, scrapers, schema.sql
types/              Shared TypeScript types
public/             PWA manifest, service worker, icons
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

With the dev server running, trigger a manual scrape:

```bash
curl -X POST http://localhost:3000/api/scrape -H "x-cron-secret: <your CRON_SECRET>"
```

You should see console logs in the terminal running `npm run dev` showing games being
fetched from Action Network and written to Supabase. Refresh the dashboard's LINES tab
(or click Refresh) to see the data appear.

## Deployment

- **Vercel**: connect this GitHub repo, add the same environment variables in
  Project Settings → Environment Variables, deploy.
- **Railway**: cron job that calls `POST https://<your-vercel-domain>/api/scrape`
  with header `x-cron-secret: <CRON_SECRET>` every minute — set up in a later session.

## Roadmap

See [`claude.md`](claude.md) for the full phased build plan (line movement tracking,
steam detection, CLV, arbitrage, prediction markets).
