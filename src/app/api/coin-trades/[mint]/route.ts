import { NextRequest, NextResponse } from 'next/server';
import { getSolPrice, getTokenMetadata, getTokenCreator } from '@/lib/helius';
import db from '@/lib/db';
import { MIN_BUY_SOL } from '@/lib/constants';
import { detectEarlyBuyers } from '@/lib/pumpfun';
import { fetchEarlyBondingCurveBuys } from '@/lib/pump-trades';
import { isPumpTokenMint } from '@/lib/token-filters';
import { isDevWallet } from '@/lib/wallet-tags';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(
  req: NextRequest,
  { params }: { params: { mint: string } }
) {
  const mint = params.mint;

  if (!isPumpTokenMint(mint)) {
    return NextResponse.json(
      { error: 'Invalid token mint' },
      { status: 400 }
    );
  }

  try {
    let coin = await db.migratedCoin.findUnique({ where: { mint } });
    if (!coin) {
      let meta = { name: 'Unknown', symbol: '???', image: null as string | null };
      try {
        const metadata = await getTokenMetadata([mint]);
        if (metadata[0]) {
          meta = { name: metadata[0].name, symbol: metadata[0].symbol, image: metadata[0].image ?? null };
        }
      } catch {}

      coin = await db.migratedCoin.upsert({
        where: { mint },
        create: { mint, name: meta.name, symbol: meta.symbol, migratedAt: new Date() },
        update: { name: meta.name, symbol: meta.symbol },
      });
    }

    const cachedEarlyBuyers = await db.earlyBuyer.findMany({
      where: { mint, isEarly: true },
      orderBy: { rank: 'asc' },
      include: { wallet_ref: true },
    });

    if (cachedEarlyBuyers.length > 0) {
      const creatorWallet = await getTokenCreator(mint).catch(() => null);
      const filteredEarly = cachedEarlyBuyers.filter(eb => eb.buyAmountSol >= MIN_BUY_SOL);
      const uniqueBuyers = new Set(filteredEarly.map(eb => eb.wallet)).size;
      const avgBuySol = filteredEarly.length > 0
        ? filteredEarly.reduce((s, eb) => s + eb.buyAmountSol, 0) / filteredEarly.length
        : 0;

      return NextResponse.json({
        coin: {
          ...coin,
          migratedAt: coin.migratedAt.toISOString(),
          createdAt: coin.createdAt.toISOString(),
          updatedAt: coin.updatedAt.toISOString(),
          creatorWallet,
        },
        trades: [],
        earlyBuyers: filteredEarly.map((eb: any) => ({
          ...eb,
          createdAt: eb.createdAt.toISOString(),
          lastSoldAt: eb.lastSoldAt ? eb.lastSoldAt.toISOString() : null,
          realizedPnlSol: eb.realizedPnlSol,
          hasSold: eb.hasSold,
          soldAmountSol: eb.soldAmountSol,
          walletScore: eb.wallet_ref?.score || 0,
          walletTier: eb.wallet_ref?.tier || 'UNKNOWN',
          labelled: eb.wallet_ref?.labelled,
          isDev: isDevWallet(eb.wallet, creatorWallet),
        })),
        stats: {
          totalBuys: filteredEarly.length,
          totalSells: 0,
          uniqueBuyers,
          earlyBuyerCount: filteredEarly.length,
          avgBuySol,
          txsParsed: cachedEarlyBuyers.length,
        },
      });
    }

    const solPrice = await getSolPrice();
    const creatorWallet = await getTokenCreator(mint);

    const migrationAgeMs = Date.now() - coin.migratedAt.getTime();
    const useMigrationCutoff = Boolean(coin.migrationTxSig) || migrationAgeMs > 60 * 60 * 1000;

    let buyTrades: Awaited<ReturnType<typeof fetchEarlyBondingCurveBuys>> = [];
    try {
      buyTrades = await fetchEarlyBondingCurveBuys(mint, solPrice, {
        migratedAt: useMigrationCutoff ? coin.migratedAt : undefined,
      });
    } catch (fetchErr) {
      console.warn('Early buy fetch failed:', fetchErr);
      return NextResponse.json(
        { error: 'Failed to load early buyers from chain. Try again in a moment.', detail: String(fetchErr) },
        { status: 503 }
      );
    }

    // Clear old data and re-insert fresh
    await db.trade.deleteMany({ where: { mint } });
    await db.earlyBuyer.deleteMany({ where: { mint } });

    for (const trade of buyTrades) {
      try {
        await db.wallet.upsert({
          where: { address: trade.wallet },
          create: { address: trade.wallet },
          update: { lastActive: new Date(trade.timestamp) },
        });
        
        await (db.trade.create as any)({
          data: {
            mint,
            wallet: trade.wallet,
            type: trade.type, 
            solAmount: trade.solAmount,
            tokenAmount: trade.tokenAmount,
            priceUsd: trade.solAmount > 0 ? trade.solAmount * solPrice : null,
            signature: trade.signature,
            timestamp: new Date(trade.timestamp),
          },
        });
      } catch {
        // skip duplicate signature
      }
    }

    const earlyBuyers = detectEarlyBuyers(buyTrades, solPrice);

    for (const eb of earlyBuyers) {
      await (db.earlyBuyer.upsert as any)({
        where: { mint_wallet: { mint, wallet: eb.wallet } },
        create: {
          mint,
          wallet: eb.wallet,
          buyAmountSol: eb.solAmount,
          buyAmountUsd: eb.solAmount * solPrice,
          marketCapAtBuy: eb.marketCapAtBuy,
          isEarly: true,
          rank: eb.rank,
          soldAmountSol: eb.soldAmountSol,
          realizedPnlSol: eb.realizedPnlSol,
          hasSold: eb.hasSold,
          lastSoldAt: eb.lastSoldAt,
        },
        update: { 
          rank: eb.rank, 
          marketCapAtBuy: eb.marketCapAtBuy,
          soldAmountSol: eb.soldAmountSol,
          realizedPnlSol: eb.realizedPnlSol,
          hasSold: eb.hasSold,
          lastSoldAt: eb.lastSoldAt,
        },
      });
    }

    const earlyBuyerRecords = await db.earlyBuyer.findMany({
      where: { mint, isEarly: true },
      orderBy: { rank: 'asc' },
      include: { wallet_ref: true },
    });

    const filteredEarly = earlyBuyerRecords.filter(eb => eb.buyAmountSol >= MIN_BUY_SOL);
    const uniqueBuyers = new Set(filteredEarly.map(eb => eb.wallet)).size;
    const avgBuySol = filteredEarly.length > 0
      ? filteredEarly.reduce((s, eb) => s + eb.buyAmountSol, 0) / filteredEarly.length
      : 0;

    return NextResponse.json({
      coin: {
        ...coin,
        migratedAt: coin.migratedAt.toISOString(),
        createdAt: coin.createdAt.toISOString(),
        updatedAt: coin.updatedAt.toISOString(),
        creatorWallet,
      },
      trades: [],
      earlyBuyers: filteredEarly.map((eb: any) => ({
        ...eb,
        createdAt: eb.createdAt.toISOString(),
        lastSoldAt: eb.lastSoldAt ? eb.lastSoldAt.toISOString() : null,
        realizedPnlSol: eb.realizedPnlSol, 
        hasSold: eb.hasSold,               
        soldAmountSol: eb.soldAmountSol,   
        walletScore: eb.wallet_ref?.score || 0,
        walletTier: eb.wallet_ref?.tier || 'UNKNOWN',
        labelled: eb.wallet_ref?.labelled,
        isDev: isDevWallet(eb.wallet, creatorWallet),
      })),
      stats: {
        totalBuys: filteredEarly.length,
        totalSells: 0,
        uniqueBuyers,
        earlyBuyerCount: filteredEarly.length,
        avgBuySol,
        txsParsed: buyTrades.length,
      },
    });
  } catch (error: any) {
    console.error('Coin trades error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}