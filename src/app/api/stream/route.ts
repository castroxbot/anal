import Client from '@triton-one/yellowstone-grpc';
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
let isGrpcActive = false;
let lastSeenSignatures = new Set<string>();

async function startGrpcStream() {
  if (isGrpcActive) return;
  isGrpcActive = true;

  // Establish a connection with the PublicNode Yellowstone gRPC plugin
  const client = new Client("solana-yellowstone-grpc.publicnode.com:443", undefined, {});
  const stream = await client.subscribe();

  const request = {
    transactions: {
      migrationFilter: {
        accountInclude: ["39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg"], // PumpFun Migration Program
        accountExclude: [],
        accountRequired: []
      }
    },
    slots: {},
    accounts: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
  };

  await stream.write(request);
  console.log("[gRPC] Successfully subscribed to live PumpFun migrations.");

  stream.on("data", async (packet) => {
    // Skip if no active UI clients are connected to save compute resources
    if (clients.size === 0 || !packet.transaction) return;

    try {
      // Triggered instantly! Fetch perfectly parsed migration elements via Helius records
      const migrations = await getRecentMigrations(5);
      const newMigrations = migrations.filter(m => !lastSeenSignatures.has(m.signature));

      if (newMigrations.length === 0) return;

      // Fetch metadata for new mints
      const mints = newMigrations.map(m => m.mint);
      let metadataMap: Record<string, { name: string; symbol: string; image: string | null; isMayhem: boolean }> = {};
      
      try {
        const metadata = await getTokenMetadata(mints);
        for (let i = 0; i < metadata.length; i++) {
          const m = metadata[i];
          metadataMap[m.mint] = { 
            name: m.name, 
            symbol: m.symbol, 
            image: m.image || null,
            isMayhem: (m as any).isMayhem
          };
        }
      } catch (metaErr) {
        console.error('Metadata fetch failed:', metaErr);
      }

      const solPrice = await getSolPrice();

      for (let i = 0; i < newMigrations.length; i++) {
        const migration = newMigrations[i];
        const meta = metadataMap[migration.mint] || { name: 'Unknown', symbol: '???', image: null, isMayhem: false };
        
        if (meta.isMayhem) {
          await (prisma.migratedCoin.delete as any)({ where: { mint: migration.mint } }).catch(() => {});
          continue; 
        }

        const migrationDate = new Date(migration.timestamp * 1000);

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

        console.log(`[gRPC-Bot] Pre-fetching early buyers for mint: ${migration.mint}`);
        const earlyCurveBuys = await fetchEarlyBondingCurveBuys(migration.mint, solPrice, {
          migratedAt: migrationDate,
        });

        const uniqueWallets = new Set<string>();

        for (let j = 0; j < earlyCurveBuys.length; j++) {
          const buy = earlyCurveBuys[j];
          uniqueWallets.add(buy.wallet);

          await prisma.wallet.upsert({
            where: { address: buy.wallet },
            update: {},
            create: {
              address: buy.wallet,
              score: 0,
              tier: 'UNKNOWN',
            },
          });

          await (prisma.trade.upsert as any)({
            where: { signature: buy.signature },
            update: {},
            create: {
              mint: migration.mint,
              wallet: buy.wallet,
              type: buy.type, // Custom multi-trade parsing field support
              solAmount: buy.solAmount,
              tokenAmount: buy.tokenAmount,
              signature: buy.signature,
              timestamp: new Date(buy.timestamp),
            },
          });

          await (prisma.earlyBuyer.upsert as any)({
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

        console.log(`[gRPC-Bot] Profiling matrix profiles for ${uniqueWallets.size} wallets...`);
        const walletArray = Array.from(uniqueWallets);
        for (const walletAddress of walletArray) {
          const allWalletTrades = await prisma.trade.findMany({
            where: { wallet: walletAddress },
          });
          const allWalletEarlyBuys = await prisma.earlyBuyer.findMany({
            where: { wallet: walletAddress },
          });

          const formattedTrades = allWalletTrades.map((t: any) => ({
            id: t.id,
            mint: t.mint,
            wallet: t.wallet,
            type: t.type,
            solAmount: t.solAmount,
            tokenAmount: t.tokenAmount,
            priceUsd: t.priceUsd ?? null,
            signature: t.signature,
            timestamp: typeof t.timestamp === 'string' ? t.timestamp : t.timestamp.toISOString(),
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
        }

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
          },
          timestamp: Date.now(),
        });

        lastSeenSignatures.add(migration.signature);
      }

      if (lastSeenSignatures.size > 500) {
        const arr = Array.from(lastSeenSignatures);
        lastSeenSignatures = new Set(arr.slice(-200));
      }
    } catch (err) {
      console.error('gRPC stream processor error:', err);
    }
  });

  stream.on("error", (err) => {
    console.error("gRPC Stream dropped, re-establishing worker instance...", err);
    isGrpcActive = false;
    setTimeout(startGrpcStream, 5000); 
  });
}

export async function GET(req: NextRequest) {
  const stream = new ReadableStream({
    start(controller) {
      clients.add(controller);
      startGrpcStream(); // Canlı gRPC akışını tetikler

      // İlk bağlantı için heartbeat mesajı gönder
      const heartbeat: SSEMessage = {
        type: 'HEARTBEAT',
        data: null,
        timestamp: Date.now(),
      };
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify(heartbeat)}\n\n`)
      );

      // Tarayıcı sekmesi kapatıldığında istemciyi listeden temizle
      req.signal.addEventListener('abort', () => {
        clients.delete(controller);
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