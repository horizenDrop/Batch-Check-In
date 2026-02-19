# Build & Arena

Session roguelike PvE -> timed arena PvP MVP for Base Mini App.

## Implemented MVP Endpoints
- `POST /api/run/start`
- `POST /api/run/choice`
- `POST /api/run/finish`
- `GET /api/builds`
- `POST /api/arena/enter`
- `GET /api/arena/state`
- `GET /api/leaderboard?type=small|daily|weekly`
- `GET /api/player`
- `GET /api/health`

## Local Player Identity
- If no auth is configured yet, backend uses `x-player-id` header.
- Frontend sets a random local `playerId` in `localStorage`.

## Economy and Protections
- Arena entry has coin costs: `small=20`, `daily=80`, `weekly=200`.
- One player can only enter once per arena season window.
- Build locks after arena entry and unlocks after resolve.
- Basic API rate limits are enabled for mutation routes.

## Structure
- `site/`: mini app frontend source
- `public/`: generated static output
- `api/`: serverless API routes
- `api/_lib/`: game engine and storage helpers
- `ROADMAP.md`: phased implementation plan

## Build
```bash
npm run build
```

## Smoke Test
```bash
npm run smoke
```

## Deployment
- Use `DEPLOY_CHECKLIST.md` before pushing to production.
