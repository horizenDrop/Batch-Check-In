# Build & Arena Roadmap

## Goal
Deliver an MVP for "PvE run -> Build slots -> Timed arenas" as a Base Mini App with server-authoritative, deterministic battle resolution.

## Product Scope (MVP)
- 10-round PvE run with 3 choices per round.
- Build snapshot creation with score, traits, units, seed.
- Up to 10 build slots per player.
- Arena submission for `small` (15m), `daily` (24h), `weekly` (7d).
- Server-side arena resolve and rewards.
- Leaderboards by arena type and season.

## Phased Delivery

### M0 - Foundation
- Base Mini App scaffold, static host generation, API baseline.
- Health route and shared server helpers.
- Done: yes.

### M1 - Core Game Loop
- `POST /run/start`, `POST /run/choice`, `POST /run/finish`.
- Deterministic choice generation from seed.
- PvE round simulation fully server-side.
- Acceptance:
  - 10-round run can be completed in about 5-10 minutes.
  - Build snapshot is produced and stored into a selected slot.

### M2 - Build Inventory
- `GET /builds` with slots and lock states.
- Replace-in-slot behavior for old builds.
- Rule: one build cannot be in two arenas at once.

### M3 - Timed Arenas
- `POST /arena/enter` with lock + UTC windows.
- `GET /arena/state` for cycle status and player entries.
- Server-side resolve on window close.
- Rewards, rank, cups/MMR updates.
- Done in current build: yes (lazy resolve model).

### M4 - Leaderboards and Polish
- `GET /leaderboard` for `small|daily|weekly`.
- Better UX states, loading, errors.
- Feature checklist pass for Base Mini App.
- Done in current build: partial (missing auth binding + background jobs).

## Technical Architecture
- Frontend: static mini app shell (`site/`) generated into `public/`.
- Backend: serverless routes (`api/`) with shared logic in `api/_lib`.
- Storage:
  - Primary: Redis when `REDIS_URL` is present.
  - Fallback: in-memory map for local demo.
- Determinism: hash+seed based pseudo-random calls only on server.

## Data Model
- Player: wallet/nickname placeholders, soft/hard currency, mmr, stats.
- Run: round, hp, picks, seed, status.
- Build: traits, units, powerScore, slotIndex, lock flags.
- ArenaEntry: type, seasonId, lockAt, resultAt, rank, reward, status.
- Leaderboard row: type, seasonId, rank, score, playerId.

## Base Mini App Checklist Alignment
- Manifest/frame metadata generated at build in `public/index.html`.
- Works as mobile-first standalone page.
- Client is non-authoritative for outcomes.
- API failures handled with explicit user messaging.
- UTC timers for arena windows.

## Post-MVP Hardening
- Real auth (Farcaster/Base account binding).
- Anti-abuse controls (rate limits, signature checks).
- Scheduled jobs for arena resolve instead of lazy resolve.
- Telemetry: funnel, retention, run completion, arena conversion.
- Economy balancing and content expansion.
