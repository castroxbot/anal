# PumpScan — PumpFun Wallet Analyzer

Real-time intelligence dashboard for tracking early buyers on migrated PumpFun coins.

## What It Does

- **Detects migrations**: Monitors the PumpFun → Raydium migration program in real-time
- **Fetches early buyers**: For each migrated coin, finds wallets that bought before **$15K market cap**
- **Scores wallets**: Multi-factor scoring (0–100) based on early buy frequency, win rate, avg return, rug avoidance
- **Live updates**: SSE stream pushes new migrations to your browser instantly
- **PostgreSQL storage**: All data persisted for historical analysis

## Stack

```
Next.js 14 (App Router)
├── Frontend          → React, Tailwind CSS, Recharts
├── API Routes        → Helius RPC, Solana web3.js
├── Real-time         → Server-Sent Events (SSE)
└── Database          → PostgreSQL via Prisma ORM
```

## Scoring System

| Category       | Weight | Description                          |
|----------------|--------|--------------------------------------|
| Early Buys     | 30pts  | % of buys made before $15K mcap     |
| Win Rate       | 25pts  | % of coins they profited from        |
| Avg Multiple   | 25pts  | Average return (e.g. 5x, 10x)       |
| Activity       | 10pts  | Consistent non-bot activity          |
| Rug Avoidance  | 10pts  | Avoids rugs / slow rugs              |

### Wallet Tiers
- 👑 **ELITE** (80–100): Consistent top performers
- 🧠 **SMART** (60–79): Above-average early buyers  
- 📊 **AVERAGE** (40–59): Standard traders
- 💸 **POOR** (0–39): Mostly losing wallets

### Auto-Labels
- `sniper` — >80% early buy rate
- `insider` — >90% early buy + >80% win rate
- `whale` — avg trade size >10 SOL
- `bot` — trades faster than 5s average

## Setup

### 1. Prerequisites

- Node.js 18+
- PostgreSQL 14+

### 2. Install

```bash
npm install
```

### 3. Database

```bash
# Create database
createdb pumpfun_analyzer

# Apply schema
npx prisma db push

# (Optional) Open Prisma Studio
npx prisma studio
```

### 4. Environment

Copy `.env.example` → `.env.local` (already pre-filled with your keys):

```env
HELIUS_API_KEY=9465d826-ab46-4de2-9cd8-171c344c4e98
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=...
SOLANA_RPC_URL=https://solana-rpc.publicnode.com
SOLANA_WS_URL=wss://solana-rpc.publicnode.com
DATABASE_URL=postgresql://user:pass@localhost:5432/pumpfun_analyzer
```

### 5. Run

```bash
npm run dev
```

Open http://localhost:3000

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/migrated-coins` | List recent migrations |
| GET | `/api/coin-trades/:mint` | Trades + early buyers for a coin |
| GET | `/api/wallet-score/:wallet` | Score a wallet address |
| GET | `/api/stream` | SSE stream for real-time events |

### Query params
- `/api/migrated-coins?limit=20` — number of coins to fetch
- `/api/migrated-coins?refresh=true` — force fresh data from chain

## Deployment (Vercel)

```bash
npm install -g vercel
vercel deploy
```

Add env vars in Vercel dashboard. Use a managed PostgreSQL service (Supabase, Neon, Railway).

## RPC Endpoints Used

| Service | URL | Purpose |
|---------|-----|---------|
| Helius | `mainnet.helius-rpc.com` | Transaction parsing, DAS metadata |
| PublicNode | `solana-rpc.publicnode.com` | MEV-protected RPC |
| PublicNode WS | `wss://solana-rpc.publicnode.com` | WebSocket subscriptions |
| PublicNode gRPC | `solana-yellowstone-grpc.publicnode.com:443` | High-throughput streaming |

## Architecture

```
Browser
  │
  ├── GET /api/migrated-coins
  │     └── Helius API → getRecentMigrations()
  │           └── PostgreSQL cache
  │
  ├── GET /api/coin-trades/:mint
  │     └── Helius API → getTradesForMint()
  │           ├── Parse early buyers (< $15K mcap)
  │           └── Upsert to PostgreSQL
  │
  ├── GET /api/wallet-score/:wallet
  │     └── scorer.ts → scoreWallet()
  │           └── Save score to PostgreSQL
  │
  └── GET /api/stream (SSE)
        └── Background poller (15s interval)
              └── Broadcasts new migrations to all clients
```
