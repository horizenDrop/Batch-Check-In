# Batch Check-In Mini App

Mini app with 3 actions:
- `1 check-in`
- `10 check-ins`
- `100 check-ins`

Each action uses:
1. `POST /api/checkin/request` to create a signing challenge
2. one wallet signature (`personal_sign`)
3. `POST /api/checkin/execute` to apply selected batch server-side

## API
- `GET /api/checkin/state`
- `POST /api/checkin/request`
- `POST /api/checkin/execute`
- `GET /api/health`

## Local Build
```bash
npm run build
```

## Smoke Test
```bash
npm run smoke
```
