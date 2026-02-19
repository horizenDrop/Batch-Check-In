# Build & Arena Deploy Checklist (Base Mini App)

## 1. Environment
- Set `APP_URL` to the production HTTPS URL.
- Set `REDIS_URL` for persistent player/build/arena state.
- Keep Farcaster/Base variables in sync with your app registration.

## 2. Build and Validate
- Run `npm run build`.
- Run `npm run smoke`.
- Confirm generated `public/index.html` contains valid `fc:frame` metadata.

## 3. API Health
- Check `GET /api/health`.
- Check `GET /api/player` with `x-player-id` header.
- Run one full cycle:
  - `POST /api/run/start`
  - `POST /api/run/choice` (until run ends)
  - `POST /api/run/finish`
  - `POST /api/arena/enter`
  - `GET /api/arena/state`

## 4. Base Mini App Readiness
- Mobile layout verified in Base app webview.
- No client-authoritative results (all resolve is server-side).
- Arena windows are UTC-based.
- Error states are visible in UI log panel.

## 5. Post-Deploy Observability
- Add request logging and error alerts.
- Track funnel metrics:
  - run start -> run finish
  - build saved -> arena entered
  - arena entered -> reward claimed via resolved result

## 6. Required Before Public Launch
- Replace local `playerId` fallback with real account binding/signature auth.
- Add scheduled jobs/cron for guaranteed arena resolve at window close.
- Add stricter anti-abuse controls (IP/device throttles and per-wallet limits).
