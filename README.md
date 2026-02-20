# Batch Check-In Mini App

Mini app with 3 actions:
- `1 check-in`
- `10 check-ins`
- `100 check-ins`

Primary flow (current UI):
1. Send cheap Base Mainnet transaction (self-transfer `0 ETH`)
2. Wait for confirmation
3. `POST /api/checkin/onchain-execute` applies selected batch after tx verification

## API
- `GET /api/checkin/state`
- `POST /api/checkin/onchain-execute`
- `POST /api/checkin/request`
- `POST /api/checkin/execute`
- `GET /api/health`

## Base Mainnet Signature Verification
- Supports EOA signatures and ERC-1271 smart wallet signatures.
- Uses `BASE_RPC_URL` (default `https://mainnet.base.org`) to validate contract-wallet signatures.

## Security and Reliability
- Rate limits on challenge, execute, and onchain-execute endpoints.
- Idempotent execute via `requestId` (safe retries without double-apply).
- Session tokens are short-lived and rotated on every execute.
- Structured signature verification logs are emitted server-side.

## Local Build
```bash
npm run build
```

## Smoke Test
```bash
npm run smoke
```
