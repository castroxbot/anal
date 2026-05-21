import { NextRequest, NextResponse } from 'next/server';
import { getTransactionHistory, getSolPrice } from '@/lib/helius';
import db from '@/lib/db';
import { scoreWallet, buildWalletHistoryFromTrades } from '@/lib/scorer';
import { Trade, EarlyBuyer } from '@/types';
import { isValidPublicKey } from '@/lib/solana-rpc';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { wallet: string } }
) {
  const { wallet } = params;

  if (!isValidPublicKey(wallet)) {
    return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
  }

  try {
    // 1. Check cached score in DB
    const dbWallet = await db.wallet.findUnique({ where: { address: wallet } });
    
    // Return cached if fresh enough (< 10 min)
    if (dbWallet && dbWallet.score > 0 && dbWallet.updatedAt) {
      const age = Date.now() - dbWallet.updatedAt.getTime();
      if (age < 10 * 60 * 1000) {
        // Get breakdown from DB trades
        const dbTrades = await db.trade.findMany({ where: { wallet } });
        const dbEarlyBuys = await db.earlyBuyer.findMany({ where: { wallet } });

        return NextResponse.json({
          wallet: {
            address: wallet,
            score: dbWallet.score,
            tier: dbWallet.tier,
            earlyBuyCount: dbWallet.earlyBuyCount,
            winRate: dbWallet.winRate,
            avgMultiple: dbWallet.avgMultiple,
            totalPnlSol: dbWallet.totalPnlSol,
            rugCount: dbWallet.rugCount,
            totalTrades: dbWallet.totalTrades,
            labelled: dbWallet.labelled,
            lastActive: dbWallet.lastActive?.toISOString() || null,
            breakdown: {
              earlyBuyScore: 0,
              winRateScore: 0,
              multipleScore: 0,
              activityScore: 0,
              rugAvoidScore: 0,
            },
          },
          source: 'cache',
        });
      }
    }

    // 2. Fetch wallet trade history from Helius
    const solPrice = await getSolPrice();
    const rawHistory = await getTransactionHistory(wallet, {
      limit: 100,
      type: 'SWAP',
    });

    // 3. Get all trades from DB for this wallet
    const dbTrades = await db.trade.findMany({
      where: { wallet },
      orderBy: { timestamp: 'desc' },
    });

    const dbEarlyBuys = await db.earlyBuyer.findMany({
      where: { wallet },
    });

    // Convert DB records to Trade type
    const trades: Trade[] = dbTrades.map(t => ({
      id: t.id,
      mint: t.mint,
      wallet: t.wallet,
      type: t.type as 'BUY' | 'SELL',
      solAmount: t.solAmount,
      tokenAmount: t.tokenAmount,
      priceUsd: t.priceUsd,
      signature: t.signature,
      timestamp: t.timestamp.toISOString(),
      slot: t.slot ? Number(t.slot) : null,
    }));

    const earlyBuys: EarlyBuyer[] = dbEarlyBuys.map(eb => ({
      id: eb.id,
      mint: eb.mint,
      wallet: eb.wallet,
      buyAmountSol: eb.buyAmountSol,
      buyAmountUsd: eb.buyAmountUsd,
      marketCapAtBuy: eb.marketCapAtBuy,
      isEarly: eb.isEarly,
      rank: eb.rank,
    }));

    // 4. Build history and score
    const history = buildWalletHistoryFromTrades(wallet, trades, earlyBuys);
    const scored = scoreWallet(history);

    // 5. Save score to DB
    await db.wallet.upsert({
      where: { address: wallet },
      create: {
        address: wallet,
        score: scored.score,
        tier: scored.tier,
        earlyBuyCount: scored.earlyBuyCount,
        winRate: scored.winRate,
        avgMultiple: scored.avgMultiple,
        totalPnlSol: scored.totalPnlSol,
        rugCount: scored.rugCount,
        totalTrades: scored.totalTrades,
        labelled: scored.labelled,
        lastActive: scored.lastActive ? new Date(scored.lastActive) : null,
      },
      update: {
        score: scored.score,
        tier: scored.tier,
        earlyBuyCount: scored.earlyBuyCount,
        winRate: scored.winRate,
        avgMultiple: scored.avgMultiple,
        totalPnlSol: scored.totalPnlSol,
        rugCount: scored.rugCount,
        totalTrades: scored.totalTrades,
        labelled: scored.labelled,
        lastActive: scored.lastActive ? new Date(scored.lastActive) : null,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({
      wallet: scored,
      source: 'live',
    });
  } catch (error: any) {
    console.error('Wallet score error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
