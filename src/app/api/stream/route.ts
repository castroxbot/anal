import { NextRequest } from 'next/server';
import { getRecentMigrations, getTokenMetadata, getSolPrice } from '@/lib/helius';
import { fetchEarlyBondingCurveBuys } from '@/lib/pump-trades';
import { scoreWallet, buildWalletHistoryFromTrades } from '@/lib/scorer';
import prisma from '@/lib/db';
import { SSEMessage } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Global state for SSE clients
const clients = new Set<ReadableStreamDefaultController>();

// Broadcast to all connected SSE clients
export function broadcastSSE(message: SSEMessage): void {
  const data = `data: ${JSON.stringify(message)}\n\n`;
  
  clients.forEach((controller) => {
    try {
      controller.enqueue(new TextEncoder().encode(data));
    } catch {
      clients.delete(controller);
    }
  });
}

// Poll for new migrations in background
let pollingInterval: NodeJS.Timeout | null = null;
let lastSeenSignatures = new Set<string>();

function startPolling() {
  if (pollingInterval) return;

  pollingInterval = setInterval(async () => {
    if (clients.size === 0) return; // No clients, skip

    try {
      const migrations = await getRecentMigrations(10);
      const newMigrations = migrations.filter(m => !lastSeenSignatures.has(m.signature));

      if (newMigrations.length > 0) {
        // Fetch metadata for new mints
        const mints = newMigrations.map(m => m.mint);
        let metadataMap: Record<string, { name: string; symbol: string; image: string | null }> = {};
        
        try {
          const metadata = await getTokenMetadata(mints);
          for (let i = 0; i < metadata.length; i++) {
            const m = metadata[i];
            metadataMap[m.mint] = { 
              name: m.name, 
              symbol: m.symbol, 
              image: m.image || null 
            };
          }
        } catch (metaErr) {
          console.error('Metadata fetch failed:', metaErr);
        }

        const solPrice = await getSolPrice();

        for (let i = 0; i < newMigrations.length; i++) {
          const migration = newMigrations[i];
          const meta = metadataMap[migration.mint] || { name: 'Unknown', symbol: '???', image: null };
          const migrationDate = new Date(migration.timestamp * 1000);

          // 1. Automatically save/cache Migrated Coin with its Image (Typecast to bypass stale prisma clients safely)
          await (prisma.migratedCoin.upsert as any)({
            where: { mint: migration.mint },
            update: {
              name: meta.name,
              symbol: meta.symbol,
              image: meta.image,
              migrationTxSig: migration.signature,
              migratedAt: migrationDate,
            },
            create: {
              mint: migration.mint,
              name: meta.name,
              symbol: meta.symbol,
              image: meta.image,
              migrationTxSig: migration.signature,
              migratedAt: migrationDate,
            },
          });

          // 2. Automatically pre-fetch early buyers immediately before UI interaction
          console.log(`[Auto-Bot] Fetching early buyers for mint: ${migration.mint}`);
          const earlyCurveBuys = await fetchEarlyBondingCurveBuys(migration.mint, solPrice, {
            migratedAt: migrationDate,
          });

          const uniqueWallets = new Set<string>();

          // 3. Automatically persist historical trades and early buyers to DB
          // 3. Automatically persist historical trades and early buyers to DB
          for (let j = 0; j < earlyCurveBuys.length; j++) {
            const buy = earlyCurveBuys[j];
            uniqueWallets.add(buy.wallet);

            // 🟢 ADD THIS BLOCK HERE TO ENSURE THE WALLET EXISTS IN DB FIRST
            await prisma.wallet.upsert({
              where: { address: buy.wallet },
              update: {},
              create: {
                address: buy.wallet,
                score: 0,
                tier: 'UNKNOWN',
              },
            });

            // Your existing code remains completely unchanged below this line:
            await prisma.trade.upsert({
              where: { signature: buy.signature },
              update: {},
              create: {
                mint: migration.mint,
                wallet: buy.wallet,
                type: 'BUY',
                solAmount: buy.solAmount,
                tokenAmount: buy.tokenAmount,
                signature: buy.signature,
                timestamp: new Date(buy.timestamp),
              },
            });

            await prisma.earlyBuyer.upsert({
              where: {
                mint_wallet: {
                  mint: migration.mint,
                  wallet: buy.wallet,
                },
              },
              update: {
                isEarly: true,
                buyAmountSol: buy.solAmount,
              },
              create: {
                mint: migration.mint,
                wallet: buy.wallet,
                buyAmountSol: buy.solAmount,
                buyAmountUsd: buy.solAmount * solPrice,
                isEarly: true,
              },
            });
          }

          // 4. Process performance scores for every unique buyer automatically
          console.log(`[Auto-Bot] Analyzing & updating profiles for ${uniqueWallets.size} wallets...`);
          
          // 🟢 Added async modifier and fixed the closing syntax at the bottom
          uniqueWallets.forEach(async (walletAddress) => {
            const allWalletTrades = await prisma.trade.findMany({
              where: { wallet: walletAddress },
            });
            const allWalletEarlyBuys = await prisma.earlyBuyer.findMany({
              where: { wallet: walletAddress },
            });

            // Re-format database elements to fit standard WalletHistory structure
            const formattedTrades = allWalletTrades.map((t: any) => ({
              id: t.id,
              mint: t.mint,
              wallet: t.wallet,
              type: t.type as 'BUY' | 'SELL',
              solAmount: t.solAmount,
              tokenAmount: t.tokenAmount,
              priceUsd: t.priceUsd ?? null,
              signature: t.signature,
              timestamp: t.timestamp.toISOString(),
              slot: t.slot ? Number(t.slot) : null,
            }));

            const formattedEarlyBuys = allWalletEarlyBuys.map((b: any) => ({
              id: b.id,
              mint: b.mint,
              wallet: b.wallet,
              buyAmountSol: b.buyAmountSol,
              buyAmountUsd: b.buyAmountUsd ?? null,
              marketCapAtBuy: b.marketCapAtBuy ?? null,
              isEarly: b.isEarly,
              rank: b.rank ?? null,
            }));

            const history = buildWalletHistoryFromTrades(walletAddress, formattedTrades, formattedEarlyBuys);
            const scoreResult = scoreWallet(history);

            // Save/Update the global Wallet Score matrix
            await prisma.wallet.upsert({
              where: { address: walletAddress },
              update: {
                score: scoreResult.score,
                tier: scoreResult.tier,
                earlyBuyCount: scoreResult.earlyBuyCount,
                winRate: scoreResult.winRate,
                avgMultiple: scoreResult.avgMultiple,
                totalPnlSol: scoreResult.totalPnlSol,
                lastActive: scoreResult.lastActive ? new Date(scoreResult.lastActive) : null,
                labelled: scoreResult.labelled,
                totalTrades: scoreResult.totalTrades,
              },
              create: {
                address: walletAddress,
                score: scoreResult.score,
                tier: scoreResult.tier,
                earlyBuyCount: scoreResult.earlyBuyCount,
                winRate: scoreResult.winRate,
                avgMultiple: scoreResult.avgMultiple,
                totalPnlSol: scoreResult.totalPnlSol,
                lastActive: scoreResult.lastActive ? new Date(scoreResult.lastActive) : null,
                labelled: scoreResult.labelled,
                totalTrades: scoreResult.totalTrades,
              },
            });
          }); // 🟢 Fixed: properly closing with }); instead of just }

// Push new updates downstream into live view
broadcastSSE({
  type: 'NEW_MIGRATION',
  data: {
    id: migration.signature,
    mint: migration.mint,
    name: meta.name,
    symbol: meta.symbol,
    image: meta.image, 
    migrationTxSig: migration.signature,
    migratedAt: migrationDate.toISOString(),
    marketCapAtMigration: null,
    currentMarketCap: null,
    raydiumPoolId: null,
  }, // 🟢 Clean and type-safe without hacks
  timestamp: Date.now(),
});

          lastSeenSignatures.add(migration.signature);
        }

        // Keep set from growing too large
        if (lastSeenSignatures.size > 500) {
          const arr = Array.from(lastSeenSignatures);
          lastSeenSignatures = new Set(arr.slice(-200));
        }
      }
    } catch (err) {
      console.error('SSE polling error:', err);
    }
  }, 300_000); // Polling interval set to 5 minutes
}

export async function GET(req: NextRequest) {
  const stream = new ReadableStream({
    start(controller) {
      clients.add(controller);
      startPolling();

      // Send initial heartbeat
      const heartbeat: SSEMessage = {
        type: 'HEARTBEAT',
        data: null,
        timestamp: Date.now(),
      };
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify(heartbeat)}\n\n`)
      );

      // Cleanup on client disconnect
      req.signal.addEventListener('abort', () => {
        clients.delete(controller);
        
        if (clients.size === 0 && pollingInterval) {
          clearInterval(pollingInterval);
          pollingInterval = null;
        }
        
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}