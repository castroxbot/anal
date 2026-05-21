'use client';

import { Trade } from '@/types';
import { formatDistanceToNow } from 'date-fns';

interface Props {
  trades: Trade[];
}

export default function TradesTable({ trades }: Props) {
  if (trades.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted text-sm">No trades found</p>
      </div>
    );
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>TYPE</th>
          <th>WALLET</th>
          <th>SOL</th>
          <th>USD</th>
          <th>TIME</th>
          <th>TX</th>
        </tr>
      </thead>
      <tbody>
        {trades.map(trade => (
          <tr key={trade.id}>
            <td>
              <span
                className={`mono text-xs px-2 py-0.5 rounded font-medium ${
                  trade.type === 'BUY'
                    ? 'bg-accent/10 text-accent'
                    : 'bg-accent2/10 text-accent2'
                }`}
              >
                {trade.type}
              </span>
            </td>
            <td>
              {trade.wallet.slice(0, 5)}...{trade.wallet.slice(-4)}
            </td>
            <td className={trade.type === 'BUY' ? 'text-accent' : 'text-accent2'}>
              ◎{trade.solAmount.toFixed(3)}
            </td>
            <td className="text-muted">
              {trade.priceUsd
                ? `$${trade.priceUsd.toFixed(2)}`
                : '—'}
            </td>
            <td className="text-muted">
              {formatDistanceToNow(new Date(trade.timestamp), { addSuffix: true })}
            </td>
            <td>
              <a
                href={`https://solscan.io/tx/${trade.signature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mono text-[10px] text-muted hover:text-accent transition-colors"
              >
                ↗
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
