# Batch Check-In Deploy Checklist

## Verify
- `npm run build`
- `npm run smoke`

## Environment
- `APP_URL` points to production URL.
- `BASE_RPC_URL` points to Base Mainnet RPC.
- `CHECKIN_CONTRACT_ADDRESS` points to deployed `BatchCheckIn` contract on Base Mainnet.
- `REDIS_URL` is set for persistent profile storage (optional but recommended).

## Flow Test In Production
1. Open app in Base.
2. Connect wallet.
3. Press `10 Check-Ins`.
4. Confirm transaction in wallet.
5. Confirm state shows `+10` total check-ins.
