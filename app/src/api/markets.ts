import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@/api/client';

export type MarketGroup = 'stocks' | 'metals' | 'oil' | 'fx' | 'crypto';

/** Mirrors server/src/markets/service.ts: the server's order is the display order. */
export type MarketQuote = {
  key: string;
  group: MarketGroup;
  label: string;
  labelEn: string;
  unit: string;
  unitEn: string;
  featured?: boolean;
  delayedMin?: number;
  price: number;
  changePct: number;
  gramSar?: number;
  at: string;
};

export type MarketsAnswer = { quotes: MarketQuote[]; source: string; updatedAt: string | null };

/** M178: the server reads every 30 s; open screens follow it. */
const LIVE_MS = 30_000;

export function useMarkets() {
  return useQuery({
    queryKey: ['markets'],
    queryFn: () => apiGet<MarketsAnswer>('/api/markets'),
    staleTime: LIVE_MS,
    refetchInterval: LIVE_MS,
  });
}
