import { NextRequest } from 'next/server';
import { getRecentMigrations, getTokenMetadata } from '@/lib/helius';
import { SSEMessage } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Global state for SSE clients
const clients = new Set<ReadableStreamDefaultController>();

// Broadcast to all connected SSE clients
export function broadcastSSE(message: SSEMessage) {
  const data = `data: ${JSON.stringify(message)}\n\n`;
  for (const controller of clients) {
    try {
      controller.enqueue(new TextEncoder().encode(data));
    } catch {
      clients.delete(controller);
    }
  }
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
        let metadataMap: Record<string, { name: string; symbol: string }> = {};
        
        try {
          const metadata = await getTokenMetadata(mints);
          for (const m of metadata) {
            metadataMap[m.mint] = { name: m.name, symbol: m.symbol };
          }
        } catch {}

        for (const migration of newMigrations) {
          const meta = metadataMap[migration.mint] || { name: 'Unknown', symbol: '???' };
          
          broadcastSSE({
            type: 'NEW_MIGRATION',
            data: {
              id: migration.signature,
              mint: migration.mint,
              name: meta.name,
              symbol: meta.symbol,
              migrationTxSig: migration.signature,
              migratedAt: new Date(migration.timestamp * 1000).toISOString(),
              marketCapAtMigration: null,
              currentMarketCap: null,
              raydiumPoolId: null,
            },
            timestamp: Date.now(),
          });

          lastSeenSignatures.add(migration.signature);
        }

        // Keep set from growing too large
        if (lastSeenSignatures.size > 500) {
          const arr = [...lastSeenSignatures];
          lastSeenSignatures = new Set(arr.slice(-200));
        }
      }
    } catch (err) {
      console.error('SSE polling error:', err);
    }
  }, 15_000); // Poll every 15 seconds
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
