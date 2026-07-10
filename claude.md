# LAF (Latent Alpha Framework)

**Purpose:** Personal sports arbitrage, line movement tracking, and +EV detection tool. Core mission: identify steam moves, track opening lines at sharp books, monitor CLV in real-time, and detect arbitrage opportunities across multiple sportsbooks and prediction markets.

**User Profile:** Laurent, 20yo, rising Kelley School of Business sophomore. Self-directed sports modeling + quantitative analytics path. Goal: beat the books, build solo betting operation. No coding experience but strong quantitative mindset. Operating with DQS/Kelly Criterion sizing framework. Deep focus on PrizePicks/FanDuel player props and World Cup 2026 soccer markets alongside MLB/WNBA. Inspired by Bob Voulgaris, Billy Walters, Moneyball.

---

## Project Scope

**Phase 1 (Session 1-2):** MVP foundation
- Data pipeline: Action Network scraping + The Odds API (free tier, sparse) → Supabase
- Dashboard with LINES tab showing live odds across books
- Schema for games, odds snapshots, opening lines, steam moves, bet entries
- PWA-enabled frontend deployed to Vercel
- Cron scraper on Railway running every 1 minute

**Phase 2 (Sessions 3-4):** Line movement intelligence
- MOVEMENT tab: opening line tracking (Pinnacle/Circa as baseline), visual price history per book
- STEAM tab: detect reverse line movement, multi-book synchronization, steam alerts
- OPENING LINES tab: display which sharp book moved first, propagation across books

**Phase 3 (Sessions 5-6):** CLV + arbitrage
- CLV tab: manual bet entry form, real-time closing line comparison, 1%/2%/3%/4%+ threshold filters
- ARB tab: true two/three-way arb detection, no-vig probability calculation, juice removal
- Alert system: browser notifications + email for high-edge opportunities

**Phase 4 (Sessions 7+):** Refinement + expansion
- Prediction market integration (Kalshi, Polymarket, Limitless, Coinbase, Robinhood)
- Historical line charts and trend analysis
- Sharp movement analytics: which books move first, velocity of moves, correlation patterns
- Optional: The Odds API upgrade (if free tier insufficient) or OddsJam migration

---

## Data Sources

- **Primary:** Action Network free scraping (covers FanDuel, DraftKings, BetMGM, Pinnacle, Circa, others)
- **Secondary:** The Odds API free tier (500 req/month, used for validation/gaps)
- **Target Books:** Pinnacle (sharp), Circa (sharp), FanDuel, DraftKings, BetMGM, Action Network aggregator
- **Prediction Markets:** Kalshi, Polymarket, Limitless, Coinbase, Robinhood (Phase 4)
- **Sports:** MLB, WNBA, Tennis, Soccer, CS2 (game lines only, no props for now)

---

## Tech Stack

- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, React, PWA (service worker + manifest)
- **Backend:** Next.js API routes, cron jobs
- **Database:** Supabase (PostgreSQL), free tier sufficient for solo use
- **Hosting:** Vercel (frontend, free), Railway (backend + cron, ~$5/month)
- **Scraping:** Action Network via fetch (no headless browser needed)
- **Domain:** latentalphaframework.markets (already purchased)
- **Deployment:** GitHub → Vercel (auto-deploy on push)

---

## Design Language

- **Colors:**
  - Background: #0a0a0a (near black)
  - Surface cards: #111111
  - Borders: #1f1f1f
  - Primary accent: #22c55e (green — positive EV, steam, profit signals)
  - Warning: #f59e0b (amber — CLV alerts, moderate edge)
  - Danger: #ef4444 (red — negative movement, losses)
  - Text primary: #f5f5f5
  - Text muted: #71717a

- **Typography:** Inter (Google Fonts), all numbers in monospace (`font-mono`)
- **Philosophy:** Minimalist, clean, designed for rapid scanning and decision-making. Pro trader aesthetic.

---

## Navigation Structure (Final)

Tabs across top of dashboard:
- **LINES** — Live odds across all books per game
- **MOVEMENT** — Opening line tracking + price history per book
- **STEAM** — Reverse line movement, multi-book sync, steam detection
- **CLV** — Manual bet entry, real-time closing line comparison, threshold filters
- **ARB** — Arbitrage opportunities, no-vig probability, juice removal

Filters available on most tabs:
- Sport selector: MLB | WNBA | TENNIS | SOCCER | CS2
- Market type: MONEYLINE | SPREAD | TOTAL
- Book filter (optional per tab)
- Time range (future expansion)

---

## Database Schema Summary

**Core Tables:**
- `books` — Sportsbooks + prediction markets (with `is_sharp` flag)
- `sports` — Sports and leagues
- `games` — Individual matchups/events
- `odds_snapshots` — Every price recorded (timestamp + game + book + market + outcome + price)
- `opening_lines` — Denormalized opening prices per book per game (for fast lookup)
- `steam_moves` — Detected steam events (trigger book, direction, books affected)
- `bet_entries` — Manual bet logging (entry price, stake, closing price, CLV calculation)

**Design Principle:** Every odds snapshot is timestamped and immutable. Historical data accumulates automatically. Opening lines are a separate table for speed.

---

## Key Features by Priority

**MVP (Session 1-2):**
1. ✅ Live odds display across 5+ books
2. ✅ 1-minute data polling via cron
3. ✅ Historical odds storage (every snapshot)
4. ✅ PWA deployment (mobile-ready)

**High Priority (Sessions 3-4):**
5. Opening line tracking per sharp book
6. Visual price history charts
7. Steam move detection (multi-book sync, direction reversal)
8. Trend analysis (which book moved first, velocity)

**Core (Sessions 5-6):**
9. Manual bet entry UI
10. CLV calculation (entry price vs. closing price)
11. Threshold-based filtering (1%, 2%, 3%, 4%+)
12. Arbitrage detection + no-vig calculation

**Polish (Sessions 7+):**
13. Browser/email alerts
14. Prediction market integration
15. Historical trend charts
16. Sharp movement analytics

---

## Session-by-Session Roadmap

| Session | Goal | Deliverable |
|---------|------|-------------|
| 1 | MVP data pipeline | Action Network scraper, Supabase schema, LINES tab skeleton |
| 2 | Live data display | LINES tab fully functional, live odds table, refresh logic |
| 3 | Opening line tracking | MOVEMENT tab, opening line storage, per-book history display |
| 4 | Steam detection | STEAM tab, reverse line movement detection, multi-book sync logic |
| 5 | CLV tracking | CLV tab, manual bet entry form, closing line comparison |
| 6 | Arbitrage engine | ARB tab, two/three-way arb detection, no-vig probability, de-vigging |
| 7+ | Integration + alerts | Prediction markets, browser notifications, email alerts, analytics |

---

## Important Context for Claude Code

- **User has zero coding experience.** Explain decisions. Add comments in code.
- **Speed matters.** Laurent is building toward a real operation. Prioritize functional MVP over perfect code, but maintain quality. Use established patterns (Next.js best practices).
- **Token conservation.** This is a multi-session project. Use `/compact` between sessions. Preserve this file and reference it instead of re-explaining.
- **Testing is important.** Add console.logs, manual test URLs, and validation so Laurent can see data flowing.
- **Minimize dependencies.** Use Next.js built-ins (fetch, API routes). Avoid extra npm packages where possible.
- **Database-first design.** Every decision flows from the schema. Get the data structure right before building UI.

---

## Current Status

**Setup Complete:**
- ✅ GitHub repo created: `latent-alpha-framework`
- ✅ Domain purchased: `latentalphaframework.markets`
- ✅ Supabase account created
- ✅ Railway account created
- ✅ Vercel account created
- ✅ The Odds API account created (free tier)
- ✅ Claude Code installed and connected to GitHub

**About to Start:** Session 1 — Initialize Next.js project, set up Supabase schema, build Action Network scraper, deploy MVP dashboard.