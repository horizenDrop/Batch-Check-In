# Batch Check-In Roadmap

## Current Scope
- One-page app with 3 buttons: `1`, `10`, `100`.
- One Base Mainnet contract transaction per selected batch.
- Backend verifies `CheckedIn(account,count)` event from receipt before applying.

## Next
1. Deploy and pin `BatchCheckIn` contract address in production env.
2. Add transaction history panel (latest successful tx hashes).
3. Add optional relayer mode (gasless UX) if needed.
