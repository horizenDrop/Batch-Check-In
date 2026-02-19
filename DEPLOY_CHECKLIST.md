# Batch Check-In Deploy Checklist

## Verify
- `npm run build`
- `npm run smoke`

## Environment
- `APP_URL` points to production URL.
- `REDIS_URL` is set for persistent profile/challenge storage.

## Flow Test In Production
1. Open app in Base.
2. Connect wallet.
3. Press `10 Check-Ins`.
4. Sign once.
5. Confirm state shows `+10` total check-ins.
