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
      // 🟢 Cast to any and explicitly use select to ensure image field is fetched
      const cached = await (db.migratedCoin.findMany as any)({
        orderBy: { migratedAt: 'desc' },
        take: limit,
        select: {
          id: true,
          mint: true,
          name: true,
          symbol: true,
          image: true, // 🟢 Added this line
          migrationTxSig: true,
          migratedAt: true,
          marketCapAtMigration: true,
          currentMarketCap: true,
          raydiumPoolId: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { trades: true, earlyBuyers: true },
          },
        },
      });

      if (cached.length > 0) {
        // 🟢 ADD THIS BLOCK HERE: Auto-backfill missing images for older cached records
        const missingImageMints = cached.filter((c: any) => !c.image).map((c: any) => c.mint);
        if (missingImageMints.length > 0) {
          try {
            const freshMeta = await getTokenMetadata(missingImageMints);
            for (const m of freshMeta) {
              if (m.image) {
                await (db.migratedCoin.update as any)({
                  where: { mint: m.mint },
                  data: { image: m.image },
                });
                const target = cached.find((c: any) => c.mint === m.mint);
                if (target) target.image = m.image;
              }
            }
          } catch (err) {
            console.warn('Cache backfill failed:', err);
          }
        }

        return NextResponse.json({
          coins: cached.map((c: any) => ({
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
    } // 🟢 Make sure both closing brackets are here before step 2

    // 2. Fetch fresh from chain
    // 2. Fetch fresh from chain
    const solPrice = await getSolPrice();
    
    // 🟢 Changed: Fetch a larger buffer of raw signatures (e.g., 60) so filtering leaves enough valid coins
    const migrations = await getRecentMigrations(Math.max(limit * 3, 60)); 

    if (migrations.length === 0) {
      return NextResponse.json({ coins: [], source: 'live' });
    }

    // 3. Get metadata for mints
    const uniqueMints = migrations.map(m => m.mint).filter((value, index, self) => self.indexOf(value) === index);
    let metadataMap: Record<string, { name: string; symbol: string; image: string | null; isMayhem: boolean }> = {};

    try {
      const metadata = await getTokenMetadata(uniqueMints);
      for (const m of metadata) {
        metadataMap[m.mint] = { 
          name: m.name, 
          symbol: m.symbol, 
          image: m.image || null, 
          isMayhem: (m as any).isMayhem 
        };
      }
    } catch (err) {
      console.warn('Metadata fetch failed:', err);
    } // 🟢 Fixed: Closed the inner try-catch block properly

    // 4. Upsert to DB
    const coins = [];
    for (const migration of migrations) {
      const meta = metadataMap[migration.mint] || { name: 'Unknown', symbol: '???', image: null, isMayhem: false };

      // 🟢 Updated: Actively delete the coin from the database if it's a Mayhem token
      if (meta.isMayhem) {
        await (db.migratedCoin.delete as any)({ where: { mint: migration.mint } }).catch(() => {});
        continue; 
      }

      try {
        const coin = await (db.migratedCoin.upsert as any)({
          where: { mint: migration.mint },
          create: {
            mint: migration.mint,
            name: meta.name,
            symbol: meta.symbol,
            image: meta.image, 
            migrationTxSig: migration.signature,
            migratedAt: new Date(migration.timestamp * 1000),
          },
          update: {
            name: meta.name,
            symbol: meta.symbol,
            image: meta.image, 
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

    const fullList = await (db.migratedCoin.findMany as any)({
      orderBy: { migratedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        mint: true,
        name: true,
        symbol: true,
        image: true,
        migrationTxSig: true,
        migratedAt: true,
        marketCapAtMigration: true,
        currentMarketCap: true,
        raydiumPoolId: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { trades: true, earlyBuyers: true },
        },
      },
    });

    // 🟢 ADD THIS BLOCK HERE: Auto-backfill missing images for old records when hitting refresh
    const missingLiveImageMints = fullList.filter((c: any) => !c.image).map((c: any) => c.mint);
    if (missingLiveImageMints.length > 0) {
      try {
        const freshMeta = await getTokenMetadata(missingLiveImageMints);
        for (const m of freshMeta) {
          if (m.image) {
            await (db.migratedCoin.update as any)({
              where: { mint: m.mint },
              data: { image: m.image },
            });
            const target = fullList.find((c: any) => c.mint === m.mint);
            if (target) target.image = m.image;
          }
        }
      } catch (err) {
        console.warn('Live backfill failed:', err);
      }
    }

    // Your existing return statement stays exactly the same below:

    return NextResponse.json({
      coins: fullList.map((c: any) => ({
        ...c,
        image: c.image ?? null,
        migratedAt: c.migratedAt.toISOString(),
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        tradeCount: c._count.trades,
        earlyBuyerCount: c._count.earlyBuyers,
      })),
      source: 'live',
    });
  } catch (error: any) {
    console.error('Migrated coins error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
