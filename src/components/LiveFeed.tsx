'use client';

import { SSEMessage, MigratedCoin } from '@/types';
import { formatDistanceToNow } from 'date-fns';

interface Props {
  events: SSEMessage[];
}

export default function LiveFeed({ events }: Props) {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden flex flex-col h-[calc(100vh-180px)]">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-shrink-0">
        <div className="live-dot" />
        <h2 className="font-semibold text-sm">Live Feed</h2>
        <span className="mono text-[11px] text-muted ml-auto bg-border/30 px-2 py-0.5 rounded">
          {events.length}
        </span>
      </div>

      <div className="overflow-y-auto flex-1">
        {events.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4">
            <div className="w-8 h-8 border border-border rounded-full flex items-center justify-center mb-3 animate-pulse-slow">
              <div className="live-dot" />
            </div>
            <p className="mono text-xs text-muted">MONITORING CHAIN</p>
            <p className="mono text-[10px] text-muted/50 mt-1">Waiting for migrations...</p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {events.map((event, i) => (
              <EventRow key={i} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: SSEMessage }) {
  if (event.type === 'NEW_MIGRATION') {
    const coin = event.data as MigratedCoin;
    return (
      <div className="px-4 py-3 animate-slide-in">
        <div className="flex items-start gap-2">
          <div className="w-6 h-6 rounded bg-accent/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-accent text-xs">↗</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1">
              <p className="text-xs font-medium truncate">
                {coin?.name || 'Unknown'}{' '}
                <span className="text-muted">${coin?.symbol}</span>
              </p>
              <span className="mono text-[10px] text-muted flex-shrink-0">
                {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
              </span>
            </div>
            <p className="mono text-[10px] text-muted mt-0.5">
              {coin?.mint ? `${coin.mint.slice(0, 8)}...` : ''}
            </p>
            <span className="mono text-[10px] bg-accent/5 text-accent px-1.5 py-0.5 rounded mt-1 inline-block">
              MIGRATED
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (event.type === 'NEW_TRADE') {
    return (
      <div className="px-4 py-3 animate-slide-in">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-blue-500/10 flex items-center justify-center">
            <span className="text-blue-400 text-xs">⟳</span>
          </div>
          <p className="mono text-xs text-muted">New trade detected</p>
          <span className="mono text-[10px] text-muted ml-auto">
            {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
          </span>
        </div>
      </div>
    );
  }

  return null;
}
