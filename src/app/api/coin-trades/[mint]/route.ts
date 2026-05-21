import { NextRequest, NextResponse } from 'next/server';
import { getTradesForMint, getSolPrice } from '@/lib/helius';
import db from '@/lib/db';
import { Trade } from '@/types';

export const dynamic = 'force-dynamic';

const EARLY_BUY_THRESHOLD_USD = 15_000; // $15k market cap threshold

export async function GET(
  req: NextRequest,
  { params }: { params: { mint: string } }
) {
  const mint = params.mint;

  try {
    // 1. Check if coin exists in DB
    let coin = await db.migratedCoin.findUnique({ where: { mint } });
    if (!coin) {
      return NextResponse.json({ error: 'Coin not found' }, { status: 404 });
    }

    const solPrice = await getSolPrice();

    // 2. Fetch transactions for this mint from Helius
    const rawTrades = await getTradesForMint(mint, 200);

    // 3. Parse trades
    const parsedTrades: Omit<Trade, 'id'>[] = [];

    for (const tx of rawTrades) {
      // Identify buyer/seller from token transfers
      for (const transfer of tx.tokenTransfers || []) {
        if (transfer.mint !== mint) continue;

        const isBuy = transfer.toUserAccount && transfer.toUserAccount !== mint;
        const wallet = isBuy ? transfer.toUserAccount : transfer.fromUserAccount;
        if (!wallet) continue;

        // Calculate SOL spent from native transfers
        const solTransfer = tx.nativeTransfers?.find(
          t => isBuy ? t.toUserAccount === tx.feePayer : t.fromUserAccount === tx.feePayer
        );
        const solAmount = solTransfer ? Math.abs(solTransfer.amount) / 1e9 : 0;

        parsedTrades.push({
          mint,
          wallet,
          type: isBuy ? 'BUY' : 'SELL',
          solAmount,
          tokenAmount: transfer.tokenAmount,
          priceUsd: solAmount * solPrice,
          signature: tx.signature,
          timestamp: new Date(tx.timestamp * 1000).toISOString(),
          slot: null,
        });
      }
    }

    // 4. Save trades to DB (upsert by signature)
    const savedTrades = [];
    for (const trade of parsedTrades) {
      try {
        // Ensure wallet exists in DB
        await db.wallet.upsert({
          where: { address: trade.wallet },
          create: { address: trade.wallet },
          update: { lastActive: new Date(trade.timestamp) },
        });

        const saved = await db.trade.upsert({
          where: { signature: trade.signature },
          create: {
            ...trade,
            timestamp: new Date(trade.timestamp),
          },
          update: {},
        });
        savedTrades.push(saved);
      } catch (err) {
        // Skip duplicate
      }
    }

    // 5. Identify early buyers (bought before $15k market cap)
    // Sort buys chronologically
    const buyTrades = savedTrades
      .filter(t => t.type === 'BUY')
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Calculate cumulative market cap (approx: first buys are always early)
    // Real implementation: track price progression
    const TOTAL_SUPPLY = 1_000_000_000; // PumpFun standard
    const earlyBuyers: Array<{ wallet: string; solAmount: number; rank: number; marketCapAtBuy: number }> = [];

    let cumulativeSol = 0;
    for (let i = 0; i < buyTrades.length; i++) {
      const trade = buyTrades[i];
      cumulativeSol += trade.solAmount;
      const approxMarketCapUsd = cumulativeSol * solPrice;
      
      if (approxMarketCapUsd < EARLY_BUY_THRESHOLD_USD) {
        earlyBuyers.push({
          wallet: trade.wallet,
          solAmount: trade.solAmount,
          rank: i + 1,
          marketCapAtBuy: approxMarketCapUsd,
        });
      }
    }

    // 6. Upsert early buyers to DB
    for (const eb of earlyBuyers) {
      await db.earlyBuyer.upsert({
        where: { mint_wallet: { mint, wallet: eb.wallet } },
        create: {
          mint,
          wallet: eb.wallet,
          buyAmountSol: eb.solAmount,
          buyAmountUsd: eb.solAmount * solPrice,
          marketCapAtBuy: eb.marketCapAtBuy,
          isEarly: true,
          rank: eb.rank,
        },
        update: {
          rank: eb.rank,
          marketCapAtBuy: eb.marketCapAtBuy,
        },
      });
    }

    // 7. Fetch full early buyer list with wallet scores
    const earlyBuyerRecords = await db.earlyBuyer.findMany({
      where: { mint, isEarly: true },
      orderBy: { rank: 'asc' },
      include: {
        wallet_ref: true,
      },
    });

    // 8. Stats
    const allTrades = await db.trade.findMany({ where: { mint } });
    const buys = allTrades.filter(t => t.type === 'BUY');
    const sells = allTrades.filter(t => t.type === 'SELL');
    const uniqueBuyers = new Set(buys.map(t => t.wallet)).size;

    return NextResponse.json({
      coin: {
        ...coin,
        migratedAt: coin.migratedAt.toISOString(),
        createdAt: coin.createdAt.toISOString(),
        updatedAt: coin.updatedAt.toISOString(),
      },
      trades: allTrades.slice(0, 100).map(t => ({
        ...t,
        slot: t.slot ? Number(t.slot) : null,
        timestamp: t.timestamp.toISOString(),
        createdAt: t.createdAt.toISOString(),
      })),
      earlyBuyers: earlyBuyerRecords.map(eb => ({
        ...eb,
        createdAt: eb.createdAt.toISOString(),
        walletScore: eb.wallet_ref?.score || 0,
        walletTier: eb.wallet_ref?.tier || 'UNKNOWN',
        labelled: eb.wallet_ref?.labelled,
      })),
      stats: {
        totalBuys: buys.length,
        totalSells: sells.length,
        uniqueBuyers,
        earlyBuyerCount: earlyBuyers.length,
        avgBuySol:
          buys.length > 0
            ? buys.reduce((s, t) => s + t.solAmount, 0) / buys.length
            : 0,
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
