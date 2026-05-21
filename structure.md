# PumpFun Wallet Analyzer - File Structure

pumpfun-analyzer/
├── package.json
├── next.config.js
├── tsconfig.json
├── .env.example
├── prisma/
│   └── schema.prisma
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── globals.css
│   │   └── api/
│   │       ├── migrated-coins/route.ts
│   │       ├── coin-trades/[mint]/route.ts
│   │       ├── wallet-score/[wallet]/route.ts
│   │       └── stream/route.ts  (SSE)
│   ├── components/
│   │   ├── Dashboard.tsx
│   │   ├── MigratedCoinsList.tsx
│   │   ├── WalletScoreCard.tsx
│   │   ├── TradesTable.tsx
│   │   └── LiveFeed.tsx
│   ├── lib/
│   │   ├── helius.ts
│   │   ├── solana-rpc.ts
│   │   ├── scorer.ts
│   │   └── db.ts
│   └── types/
│       └── index.ts
