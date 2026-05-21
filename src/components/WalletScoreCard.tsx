'use client';

import { useState, useEffect } from 'react';
import { WalletScore } from '@/types';
import { formatDistanceToNow } from 'date-fns';

interface Props {
  wallet: string;
  onClose: () => void;
}

export default function WalletScoreCard({ wallet, onClose }: Props) {
  const [data, setData] = useState<WalletScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/wallet-score/${wallet}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setData(json.wallet);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [wallet]);

  const tierConfig = {
    ELITE: { color: '#FFD700', emoji: '👑', label: 'ELITE' },
    SMART: { color: '#00FF88', emoji: '🧠', label: 'SMART MONEY' },
    AVERAGE: { color: '#4FC3F7', emoji: '📊', label: 'AVERAGE' },
    POOR: { color: '#FF6B35', emoji: '💸', label: 'POOR' },
    UNKNOWN: { color: '#8B949E', emoji: '❓', label: 'UNSCORED' },
  };

  const tier = data?.tier ? tierConfig[data.tier] : tierConfig.UNKNOWN;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
         onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-2xl w-full max-w-md animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <p className="mono text-xs text-muted">WALLET ANALYSIS</p>
            <p className="mono text-sm font-medium mt-0.5 text-accent">
              {wallet.slice(0, 8)}...{wallet.slice(-6)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-text transition-colors text-lg"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-8 rounded" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-center">
            <p className="text-accent2 mono text-sm">{error}</p>
          </div>
        ) : data ? (
          <>
            {/* Score hero */}
            <div className="p-5 flex items-center gap-5">
              <div
                className="w-20 h-20 rounded-2xl flex flex-col items-center justify-center border-2"
                style={{ borderColor: tier.color, backgroundColor: `${tier.color}10` }}
              >
                <span className="text-2xl">{tier.emoji}</span>
                <span
                  className="mono text-xl font-bold leading-none mt-1"
                  style={{ color: tier.color }}
                >
                  {data.score.toFixed(0)}
                </span>
              </div>
              <div>
                <p className="mono text-xs text-muted">TIER</p>
                <p className="font-bold text-lg" style={{ color: tier.color }}>
                  {tier.label}
                </p>
                {data.labelled && (
                  <span className="mono text-[11px] bg-accent2/10 text-accent2 px-2 py-0.5 rounded mt-1 inline-block">
                    {data.labelled.toUpperCase()}
                  </span>
                )}
                {data.lastActive && (
                  <p className="mono text-xs text-muted mt-1">
                    Last active {formatDistanceToNow(new Date(data.lastActive), { addSuffix: true })}
                  </p>
                )}
              </div>
            </div>

            {/* Score breakdown */}
            <div className="px-5 pb-2">
              <p className="mono text-[10px] text-muted mb-3">SCORE BREAKDOWN</p>
              <div className="space-y-2.5">
                <ScoreRow label="Early Buys" score={data.breakdown.earlyBuyScore} max={30} />
                <ScoreRow label="Win Rate" score={data.breakdown.winRateScore} max={25} />
                <ScoreRow label="Avg Multiple" score={data.breakdown.multipleScore} max={25} />
                <ScoreRow label="Activity" score={data.breakdown.activityScore} max={10} />
                <ScoreRow label="Rug Avoidance" score={data.breakdown.rugAvoidScore} max={10} />
              </div>
            </div>

            {/* Stats grid */}
            <div className="p-5 grid grid-cols-3 gap-3">
              <MiniStat label="EARLY BUYS" value={data.earlyBuyCount.toString()} />
              <MiniStat label="WIN RATE" value={`${data.winRate.toFixed(0)}%`} />
              <MiniStat label="AVG X" value={`${data.avgMultiple.toFixed(1)}x`} />
              <MiniStat
                label="TOTAL PNL"
                value={`◎${data.totalPnlSol > 0 ? '+' : ''}${data.totalPnlSol.toFixed(2)}`}
                accent={data.totalPnlSol > 0 ? 'green' : data.totalPnlSol < 0 ? 'red' : undefined}
              />
              <MiniStat label="TRADES" value={data.totalTrades.toString()} />
              <MiniStat label="RUGS" value={data.rugCount.toString()} accent={data.rugCount > 3 ? 'red' : undefined} />
            </div>

            {/* Copy address */}
            <div className="px-5 pb-5">
              <button
                onClick={() => navigator.clipboard?.writeText(wallet)}
                className="w-full py-2 mono text-xs text-muted border border-border hover:border-accent/30 hover:text-accent rounded-lg transition-all"
              >
                📋 COPY ADDRESS
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ScoreRow({ label, score, max }: { label: string; score: number; max: number }) {
  const pct = (score / max) * 100;
  const color = pct >= 80 ? '#00FF88' : pct >= 50 ? '#4FC3F7' : '#FF6B35';

  return (
    <div className="flex items-center gap-3">
      <p className="mono text-xs text-muted w-28 flex-shrink-0">{label}</p>
      <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <p className="mono text-xs w-12 text-right" style={{ color }}>
        {score.toFixed(1)}/{max}
      </p>
    </div>
  );
}

function MiniStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'green' | 'red';
}) {
  const color = accent === 'green' ? 'text-accent' : accent === 'red' ? 'text-accent2' : 'text-text';
  return (
    <div className="bg-bg/50 rounded-lg px-3 py-2 border border-border/50">
      <p className="mono text-[9px] text-muted">{label}</p>
      <p className={`mono text-sm font-bold mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}
