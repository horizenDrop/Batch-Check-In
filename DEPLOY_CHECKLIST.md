# Daily Streak Lite Deploy Checklist

## Verify
- `npm run build`
- `npm run smoke`

## Environment
- `APP_URL` points to production URL.
- `BASE_RPC_URL` points to Base Mainnet RPC.
- `CHECKIN_CONTRACT_ADDRESS` points to deployed `DailyStreakLite` contract.
- `REDIS_URL` is optional but recommended for persistence.

## Production Test
1. Open app in Base.
2. Connect wallet.
3. Press `Run Daily Check-In`.
4. Confirm transaction in wallet.
5. Confirm `streak` and `total check-ins` increment.
6. Press again on the same day and confirm cooldown/revert behavior.
7. Open `/api/streak/state` and confirm profile returns for connected wallet.
