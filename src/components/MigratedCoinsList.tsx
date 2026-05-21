'use client';

import { MigratedCoin } from '@/types';
import { formatDistanceToNow } from 'date-fns';

interface Props {
  coins: MigratedCoin[];
  loading: boolean;
  error: string | null;
  selectedMint?: string;
  onSelect: (coin: MigratedCoin) => void;
}

export default function MigratedCoinsList({ coins, loading, error, selectedMint, onSelect }: Props) {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden flex flex-col h-[calc(100vh-180px)]">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="font-semibold text-sm">Migrated Coins</h2>
          <p className="mono text-[10px] text-muted mt-0.5">PumpFun → Raydium</p>
        </div>
        {!loading && (
          <span className="mono text-[11px] text-muted bg-border/30 px-2 py-0.5 rounded">
            {coins.length}
          </span>
        )}
      </div>

      <div className="overflow-y-auto flex-1">
        {loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton h-14 rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-center">
            <p className="text-accent2 text-sm mono">ERROR</p>
            <p className="text-muted text-xs mt-1">{error}</p>
          </div>
        ) : coins.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-muted text-sm">No migrations found</p>
            <p className="text-muted/50 text-xs mt-1 mono">Try refreshing</p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {coins.map(coin => (
              <CoinRow
                key={coin.mint}
                coin={coin}
                isSelected={coin.mint === selectedMint}
                onClick={() => onSelect(coin)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CoinRow({
  coin,
  isSelected,
  onClick,
}: {
  coin: MigratedCoin;
  isSelected: boolean;
  onClick: () => void;
}) {
  const timeAgo = formatDistanceToNow(new Date(coin.migratedAt), { addSuffix: true });

  return (
    <button
      onClick={onClick}
      className={`w-full px-4 py-3 text-left hover:bg-white/[0.02] transition-all group ${
        isSelected ? 'bg-accent/5 border-l-2 border-l-accent' : 'border-l-2 border-l-transparent'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {/* Symbol badge */}
          <div className="w-8 h-8 rounded-lg bg-border/50 flex items-center justify-center flex-shrink-0 text-xs font-bold text-accent group-hover:bg-accent/10 transition-colors">
            {(coin.symbol || '??').slice(0, 3).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{coin.name || 'Unknown'}</p>
            <p className="mono text-[10px] text-muted">{coin.mint.slice(0, 8)}...{coin.mint.slice(-4)}</p>
          </div>
        </div>
        <div className="text-right flex-shrink-0 ml-2">
          <p className="mono text-[10px] text-muted">{timeAgo}</p>
          {coin.earlyBuyerCount !== undefined && (
            <p className="mono text-[11px] text-accent mt-0.5">
              {coin.earlyBuyerCount} early
            </p>
          )}
        </div>
      </div>
    </button>
  );
}
