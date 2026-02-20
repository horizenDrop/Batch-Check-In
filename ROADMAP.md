# Daily Streak Lite Roadmap

## Current Scope
- One-page Base mini app with one onchain action: `Run Daily Check-In`.
- Contract-level streak rules (one check-in per UTC day).
- Backend verifies `CheckedIn` event before updating profile.
- Concurrent execute protection to prevent duplicate tx credit.
- Auto-refresh state and mobile-first UI.

## Next
1. Add lightweight weekly leaderboard (offchain ranking by streak and total).
2. Add cosmetic badge tiers (7-day, 30-day, 100-day streak).
3. Add optional relayer mode for sponsored gas campaigns.
