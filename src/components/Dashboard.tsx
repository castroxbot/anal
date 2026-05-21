'use client';

import { useState, useEffect, useCallback } from 'react';
import { MigratedCoin, SSEMessage } from '@/types';
import MigratedCoinsList from './MigratedCoinsList';
import CoinDetail from './CoinDetail';
import LiveFeed from './LiveFeed';
import StatsBar from './StatsBar';

export default function Dashboard() {
  const [coins, setCoins] = useState<MigratedCoin[]>([]);
  const [selectedCoin, setSelectedCoin] = useState<MigratedCoin | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveEvents, setLiveEvents] = useState<SSEMessage[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch initial coins
  const fetchCoins = useCallback(async (refresh = false) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/migrated-coins?limit=30${refresh ? '&refresh=true' : ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCoins(data.coins || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch coins');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCoins();
  }, [fetchCoins]);

  // SSE connection for live updates
  useEffect(() => {
    const eventSource = new EventSource('/api/stream');

    eventSource.onopen = () => setIsLive(true);
    eventSource.onerror = () => setIsLive(false);

    eventSource.onmessage = (event) => {
      try {
        const msg: SSEMessage = JSON.parse(event.data);
        
        if (msg.type === 'HEARTBEAT') return;

        setLiveEvents(prev => [msg, ...prev.slice(0, 49)]);

        if (msg.type === 'NEW_MIGRATION' && msg.data) {
          setCoins(prev => {
            const newCoin = msg.data as MigratedCoin;
            const exists = prev.some(c => c.mint === newCoin.mint);
            if (exists) return prev;
            return [newCoin, ...prev.slice(0, 49)];
          });
        }
      } catch {}
    };

    return () => {
      eventSource.close();
      setIsLive(false);
    };
  }, []);

  return (
    <div className="min-h-screen bg-bg noise-bg">
      {/* Header */}
      <header className="border-b border-border/50 bg-surface/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center">
              <span className="text-accent text-sm">⚡</span>
            </div>
            <div>
              <h1 className="font-bold text-text text-lg leading-none tracking-tight">
                PUMP<span className="text-accent">SCAN</span>
              </h1>
              <p className="text-muted text-[10px] mono mt-0.5">Early buyer intelligence</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Live indicator */}
            <div className="flex items-center gap-2">
              <div className={`live-dot ${!isLive ? 'opacity-30' : ''}`} />
              <span className="mono text-[11px] text-muted">
                {isLive ? 'LIVE' : 'CONNECTING'}
              </span>
            </div>

            <button
              onClick={() => fetchCoins(true)}
              className="px-3 py-1.5 text-xs mono border border-border hover:border-accent/50 hover:text-accent rounded transition-all"
            >
              ↻ REFRESH
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-4 py-4">
        {/* Stats bar */}
        <StatsBar coins={coins} />

        <div className="mt-4 grid grid-cols-1 xl:grid-cols-[380px_1fr_280px] gap-4">
          {/* Left: Migrated coins list */}
          <div className="flex flex-col gap-4">
            <MigratedCoinsList
              coins={coins}
              loading={loading}
              error={error}
              selectedMint={selectedCoin?.mint}
              onSelect={setSelectedCoin}
            />
          </div>

          {/* Center: Coin detail / trades */}
          <div>
            {selectedCoin ? (
              <CoinDetail coin={selectedCoin} />
            ) : (
              <EmptyState />
            )}
          </div>

          {/* Right: Live feed */}
          <div>
            <LiveFeed events={liveEvents} />
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-[500px] border border-border rounded-xl flex flex-col items-center justify-center text-center p-8">
      <div className="text-5xl mb-4 opacity-30">⚡</div>
      <p className="text-muted text-sm mono">SELECT A COIN</p>
      <p className="text-muted/50 text-xs mt-1">Click any migrated coin to analyze early buyers</p>
    </div>
  );
}
