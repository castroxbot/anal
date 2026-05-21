'use client';

import { MigratedCoin } from '@/types';

interface StatsBarProps {
  coins: MigratedCoin[];
}

export default function StatsBar({ coins }: StatsBarProps) {
  const totalEarlyBuyers = coins.reduce((s, c) => s + (c.earlyBuyerCount || 0), 0);
  const last24h = coins.filter(c => {
    const age = Date.now() - new Date(c.migratedAt).getTime();
    return age < 24 * 60 * 60 * 1000;
  }).length;

  const stats = [
    { label: 'MIGRATIONS TRACKED', value: coins.length.toString(), accent: false },
    { label: 'LAST 24H', value: last24h.toString(), accent: false },
    { label: 'EARLY BUYERS', value: totalEarlyBuyers.toString(), accent: true },
    { label: 'THRESHOLD', value: '<$15K MCAP', accent: false },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map(stat => (
        <div
          key={stat.label}
          className="bg-surface border border-border rounded-lg px-4 py-3"
        >
          <p className="mono text-[10px] text-muted tracking-widest">{stat.label}</p>
          <p className={`text-xl font-bold mt-1 ${stat.accent ? 'text-accent' : 'text-text'}`}>
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}
