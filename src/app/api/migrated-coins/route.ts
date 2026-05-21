import { NextRequest, NextResponse } from 'next/server';
import { getRecentMigrations, getTokenMetadata, getSolPrice } from '@/lib/helius';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get('limit') || '20');
  const refresh = searchParams.get('refresh') === 'true';

  try {
    // 1. Try DB first for cached data
    if (!refresh) {
      const cached = await db.migratedCoin.findMany({
        orderBy: { migratedAt: 'desc' },
        take: limit,
        include: {
          _count: {
            select: { trades: true, earlyBuyers: true },
          },
        },
      });

      if (cached.length > 0) {
        return NextResponse.json({
          coins: cached.map(c => ({
            ...c,
            migratedAt: c.migratedAt.toISOString(),
            createdAt: c.createdAt.toISOString(),
            updatedAt: c.updatedAt.toISOString(),
            tradeCount: c._count.trades,
            earlyBuyerCount: c._count.earlyBuyers,
          })),
          source: 'cache',
        });
      }
    }

    // 2. Fetch fresh from chain
    const solPrice = await getSolPrice();
    const migrations = await getRecentMigrations(limit);

    if (migrations.length === 0) {
      return NextResponse.json({ coins: [], source: 'live' });
    }

    // 3. Get metadata for mints
    const uniqueMints = [...new Set(migrations.map(m => m.mint))];
    let metadataMap: Record<string, { name: string; symbol: string }> = {};

    try {
      const metadata = await getTokenMetadata(uniqueMints);
      for (const m of metadata) {
        metadataMap[m.mint] = { name: m.name, symbol: m.symbol };
      }
    } catch (err) {
      console.warn('Metadata fetch failed:', err);
    }

    // 4. Upsert to DB
    const coins = [];
    for (const migration of migrations) {
      const meta = metadataMap[migration.mint] || { name: 'Unknown', symbol: '???' };

      try {
        const coin = await db.migratedCoin.upsert({
          where: { mint: migration.mint },
          create: {
            mint: migration.mint,
            name: meta.name,
            symbol: meta.symbol,
            migrationTxSig: migration.signature,
            migratedAt: new Date(migration.timestamp * 1000),
          },
          update: {
            name: meta.name,
            symbol: meta.symbol,
            updatedAt: new Date(),
          },
        });
        coins.push({
          ...coin,
          migratedAt: coin.migratedAt.toISOString(),
          createdAt: coin.createdAt.toISOString(),
          updatedAt: coin.updatedAt.toISOString(),
          tradeCount: 0,
          earlyBuyerCount: 0,
        });
      } catch (err) {
        console.error(`Failed to upsert coin ${migration.mint}:`, err);
      }
    }

    return NextResponse.json({ coins, source: 'live' });
  } catch (error: any) {
    console.error('Migrated coins error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
