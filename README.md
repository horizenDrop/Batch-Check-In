# Batch Check-In Mini App

Mini app with 3 actions:
- `1 check-in`
- `10 check-ins`
- `100 check-ins`

Primary flow:
1. `POST /api/checkin/prepare` returns contract calldata for `checkIn(count)`
2. Wallet sends one Base Mainnet transaction to `BatchCheckIn` contract
3. App waits for confirmation
4. `POST /api/checkin/onchain-execute` verifies receipt event and applies exact onchain count

## API
- `GET /api/checkin/state`
- `POST /api/checkin/prepare`
- `POST /api/checkin/onchain-execute`
- `GET /api/health`

## Contract
- Solidity source: `contracts/BatchCheckIn.sol`
- Required function:
  - `checkIn(uint256 count)` where count is only `1`, `10`, or `100`
- Required event:
  - `CheckedIn(address indexed account, uint256 count)`

Deploy this contract on Base Mainnet and set its address in `CHECKIN_CONTRACT_ADDRESS`.

## Environment
- `APP_URL=https://batch-check-in.vercel.app`
- `BASE_RPC_URL=https://mainnet.base.org`
- `CHECKIN_CONTRACT_ADDRESS=0x...` (deployed Base Mainnet contract)
- `REDIS_URL=` (optional, for persistent state)

## Security and Reliability
- Rate limits on prepare and onchain-execute endpoints.
- Tx hash claim cache prevents double counting.
- Backend credits from verified contract event only (not from UI value).
- Structured onchain verification logs are emitted server-side.

## Local Build
```bash
npm run build
```

## Smoke Test
```bash
npm run smoke
```
