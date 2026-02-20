# Daily Streak Lite (Base Mini App)

One simple loop:
1. Connect wallet
2. Run one `checkIn()` tx on Base Mainnet
3. Grow daily streak + total check-ins

## App Flow
- `POST /api/checkin/prepare`: returns tx request for `checkIn()`
- Wallet submits tx to `DailyStreakLite` contract
- `POST /api/checkin/onchain-execute`: verifies tx receipt + `CheckedIn` event
- `GET /api/checkin/state`: returns wallet profile (with optional onchain sync)

## Contract
- Source: `contracts/DailyStreakLite.sol`
- Main function:
  - `checkIn()`
- View function:
  - `getStats(address)`
- Event:
  - `CheckedIn(address account, uint32 streak, uint64 totalCheckIns, uint64 day, uint64 nextCheckInAt)`

## Environment
- `APP_URL=https://batch-check-in.vercel.app`
- `BASE_RPC_URL=https://mainnet.base.org`
- `CHECKIN_CONTRACT_ADDRESS=0x...` (deployed `DailyStreakLite` on Base Mainnet)
- `REDIS_URL=` (optional, for persistent storage)

## Commands
```bash
npm run build
npm run smoke
```
