'use client';

import { useState, useEffect } from 'react';
import { MigratedCoin, CoinTradesResponse, EarlyBuyer } from '@/types';
import WalletScoreCard from './WalletScoreCard';
import TradesTable from './TradesTable';
import { formatDistanceToNow } from 'date-fns';

interface Props {
  coin: MigratedCoin;
}

export default function CoinDetail({ coin }: Props) {
  const [data, setData] = useState<CoinTradesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'early' | 'all'>('early');
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      setData(null);
      setSelectedWallet(null);

      try {
        const res = await fetch(`/api/coin-trades/${coin.mint}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: CoinTradesResponse = await res.json();
        setData(json);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch trades');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [coin.mint]);

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-180px)]">
      {/* Coin header */}
      <div className="bg-surface border border-border rounded-xl px-5 py-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold">{coin.name || 'Unknown'}</span>
              <span className="mono text-sm text-muted bg-border/40 px-2 py-0.5 rounded">
                {coin.symbol || '???'}
              </span>
            </div>
            <p className="mono text-xs text-muted mt-1">
              {coin.mint}
            </p>
          </div>
          <div className="text-right">
            <p className="mono text-xs text-muted">Migrated</p>
            <p className="text-sm font-medium mt-0.5">
              {formatDistanceToNow(new Date(coin.migratedAt), { addSuffix: true })}
            </p>
          </div>
        </div>

        {/* Stats row */}
        {data && (
          <div className="mt-4 grid grid-cols-4 gap-3">
            <StatBox label="EARLY BUYERS" value={data.stats.earlyBuyerCount.toString()} accent />
            <StatBox label="UNIQUE BUYERS" value={data.stats.uniqueBuyers.toString()} />
            <StatBox label="TOTAL BUYS" value={data.stats.totalBuys.toString()} />
            <StatBox label="AVG BUY" value={`◎${data.stats.avgBuySol.toFixed(2)}`} />
          </div>
        )}
      </div>

      {/* Tabs + content */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden flex-1 flex flex-col">
        <div className="flex border-b border-border flex-shrink-0">
          <TabButton
            active={activeTab === 'early'}
            onClick={() => setActiveTab('early')}
            label="Early Buyers"
            badge={data?.stats.earlyBuyerCount}
            accent
          />
          <TabButton
            active={activeTab === 'all'}
            onClick={() => setActiveTab('all')}
            label="All Trades"
            badge={data?.stats.totalBuys}
          />
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState message={error} />
          ) : data ? (
            activeTab === 'early' ? (
              <EarlyBuyersTable
                buyers={data.earlyBuyers}
                onSelectWallet={setSelectedWallet}
              />
            ) : (
              <TradesTable trades={data.trades} />
            )
          ) : null}
        </div>
      </div>

      {/* Wallet score panel */}
      {selectedWallet && (
        <WalletScoreCard
          wallet={selectedWallet}
          onClose={() => setSelectedWallet(null)}
        />
      )}
    </div>
  );
}

function StatBox({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-bg/50 rounded-lg px-3 py-2 border border-border/50">
      <p className="mono text-[9px] text-muted tracking-widest">{label}</p>
      <p className={`text-base font-bold mt-0.5 ${accent ? 'text-accent' : ''}`}>{value}</p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  badge,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-3 text-sm font-medium transition-all border-b-2 ${
        active
          ? accent
            ? 'border-accent text-accent'
            : 'border-text text-text'
          : 'border-transparent text-muted hover:text-text'
      }`}
    >
      {label}
      {badge !== undefined && (
        <span
          className={`mono ml-2 text-[11px] px-1.5 py-0.5 rounded ${
            active && accent ? 'bg-accent/10 text-accent' : 'bg-border/50 text-muted'
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function EarlyBuyersTable({
  buyers,
  onSelectWallet,
}: {
  buyers: EarlyBuyer[];
  onSelectWallet: (wallet: string) => void;
}) {
  if (buyers.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted text-sm">No early buyers found</p>
        <p className="text-muted/50 text-xs mt-1 mono">No buys detected below $15K market cap</p>
      </div>
    );
  }

  const getTierColor = (tier?: string) => {
    switch (tier) {
      case 'ELITE': return 'text-yellow-400';
      case 'SMART': return 'text-accent';
      case 'AVERAGE': return 'text-blue-400';
      case 'POOR': return 'text-accent2';
      default: return 'text-muted';
    }
  };

  const getTierEmoji = (tier?: string) => {
    switch (tier) {
      case 'ELITE': return '👑';
      case 'SMART': return '🧠';
      case 'AVERAGE': return '📊';
      case 'POOR': return '💸';
      default: return '❓';
    }
  };

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>#</th>
          <th>WALLET</th>
          <th>SOL SPENT</th>
          <th>MCAP AT BUY</th>
          <th>PROFIT (PnL)</th> {/* 🟢 Added header */}
          <th>SCORE</th>
          <th>TIER</th>
          <th>LABEL</th>
        </tr>
      </thead>
      <tbody>
        {buyers.map((buyer, i) => (
          <tr
            key={buyer.id}
            className="cursor-pointer"
            onClick={() => onSelectWallet(buyer.wallet)}
          >
            <td className="text-muted">{buyer.rank || i + 1}</td>
            <td>
              <span className="hover:text-accent transition-colors">
                {buyer.wallet.slice(0, 6)}...{buyer.wallet.slice(-4)}
              </span>
            </td>
            <td className="text-accent">◎{buyer.buyAmountSol.toFixed(3)}</td>
            <td>
              {buyer.marketCapAtBuy
                ? `$${buyer.marketCapAtBuy.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : '—'}
            </td>

            {/* 🟢 FIXED: Inserted the Profit & Loss visualization cell here to align table data columns */}
            <td className="mono text-xs font-semibold">
              {(buyer as any).hasSold ? (
                <span className={(buyer as any).realizedPnlSol >= 0 ? 'text-accent' : 'text-accent2'}>
                  {(buyer as any).realizedPnlSol >= 0 ? '+' : ''}◎{(buyer as any).realizedPnlSol.toFixed(2)}
                </span>
              ) : (
                <span className="text-muted/60">Riding 💎</span>
              )}
            </td>

            <td>
              {buyer.walletScore !== undefined && buyer.walletScore > 0 ? (
                <ScoreBar score={buyer.walletScore} />
              ) : (
                <span className="text-muted text-xs">—</span>
              )}
            </td>
            <td className={getTierColor(buyer.walletTier)}>
              {getTierEmoji(buyer.walletTier)} {buyer.walletTier || 'N/A'}
            </td>
            <td>
              {buyer.labelled ? (
                <span className="mono text-[10px] bg-accent2/10 text-accent2 px-2 py-0.5 rounded">
                  {buyer.labelled}
                </span>
              ) : (
                <span className="text-muted">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 80 ? '#FFD700' : score >= 60 ? '#00FF88' : score >= 40 ? '#4FC3F7' : '#FF6B35';

  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-border rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
      <span className="mono text-xs" style={{ color }}>
        {score.toFixed(0)}
      </span>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="p-4 space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="skeleton h-10 rounded" />
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="p-8 text-center">
      <p className="text-accent2 mono text-sm">FETCH ERROR</p>
      <p className="text-muted text-xs mt-1">{message}</p>
    </div>
  );
}
