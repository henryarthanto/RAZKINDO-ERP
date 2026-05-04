'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';

// =====================================================================
// SUPABASE REALTIME HOOK — Live data sync via Supabase postgres_changes
//
// Replaces Socket.io-based use-realtime-sync.ts with native Supabase
// Realtime subscriptions. Automatically invalidates TanStack Query
// cache when database changes are detected.
//
// REQUIREMENTS:
//   - Supabase Realtime must be ENABLED for the subscribed tables
//     in the Supabase Dashboard → Database → Replication
//   - Tables: events, transactions, products
//
// This hook is zero-infrastructure — no WebSocket mini-service needed.
// =====================================================================

/** Map of Supabase Realtime table events to TanStack Query keys */
const TABLE_CHANGE_TO_QUERY_KEYS: Record<string, Record<string, string[][]>> = {
  events: {
    INSERT: [
      ['events'],
      ['transactions'], // Most events relate to transactions
      ['dashboard'],
    ],
  },
  transactions: {
    UPDATE: [
      ['transactions'],
      ['dashboard'],
      ['receivables'],
      ['finance-requests'],
      ['pwa-pending-orders'],
      ['pwa-approved-unpaid-orders'],
      ['sales-dashboard'],
      ['courier-dashboard'],
    ],
    INSERT: [
      ['transactions'],
      ['dashboard'],
      ['pwa-pending-orders'],
      ['sales-dashboard'],
    ],
  },
  products: {
    UPDATE: [
      ['products'],
      ['dashboard'],
      ['asset-value'],
      ['stock-movements'],
    ],
    INSERT: [
      ['products'],
    ],
  },
  payments: {
    INSERT: [
      ['transactions'],
      ['dashboard'],
      ['receivables'],
      ['finance-pools'],
      ['pwa-approved-unpaid-orders'],
      ['sales-dashboard'],
    ],
    UPDATE: [
      ['transactions'],
      ['dashboard'],
      ['receivables'],
      ['finance-pools'],
    ],
  },
  finance_requests: {
    INSERT: [
      ['finance-requests'],
      ['dashboard'],
      ['finance-pools'],
    ],
    UPDATE: [
      ['finance-requests'],
      ['dashboard'],
      ['finance-pools'],
    ],
  },
  deliveries: {
    UPDATE: [
      ['transactions'],
      ['dashboard'],
      ['receivables'],
      ['courier-dashboard'],
    ],
  },
  users: {
    UPDATE: [
      ['users'],
    ],
  },
  customers: {
    INSERT: [['customers']],
    UPDATE: [['customers']],
  },
};

/** Debounce times in ms for different criticality levels */
const DEBOUNCE = {
  critical: 300,   // transactions, stock
  medium: 800,     // payments, finance
  normal: 1500,    // users, customers
};

function getDebounceMs(table: string): number {
  if (['transactions', 'products', 'payments'].includes(table)) return DEBOUNCE.critical;
  if (['finance_requests', 'deliveries', 'events'].includes(table)) return DEBOUNCE.medium;
  return DEBOUNCE.normal;
}

/**
 * Subscribe to Supabase Realtime postgres_changes and invalidate
 * TanStack Query cache keys when data changes in the database.
 *
 * This provides instant cross-client data sync without any
 * WebSocket server or Socket.io service.
 */
export function useSupabaseRealtime() {
  const queryClient = useQueryClient();
  const { user, token } = useAuthStore();
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const channelsRef = useRef<any[]>([]);

  useEffect(() => {
    if (!user?.id) return;

    // Dynamically import browser-only Supabase client
    let cancelled = false;

    async function subscribe() {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseKey) {
          console.warn('[Realtime] Supabase URL or key not configured');
          return;
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        if (cancelled) return;

        const tables = Object.keys(TABLE_CHANGE_TO_QUERY_KEYS) as Array<keyof typeof TABLE_CHANGE_TO_QUERY_KEYS>;

        for (const table of tables) {
          const events = Object.keys(TABLE_CHANGE_TO_QUERY_KEYS[table]) as Array<'INSERT' | 'UPDATE' | 'DELETE'>;

          for (const event of events) {
            const channelName = `rt-${table}-${event.toLowerCase()}`;
            const channel = supabase
              .channel(channelName, {
                config: {
                  // Only receive changes, don't broadcast presence
                  broadcast: { self: false },
                  presence: { key: '' },
                },
              })
              .on(
                'postgres_changes',
                {
                  event,
                  schema: 'public',
                  table,
                },
                () => {
                  if (cancelled) return;

                  // Find matching query keys for this table+event
                  const queryKeys = TABLE_CHANGE_TO_QUERY_KEYS[table]?.[event];
                  if (!queryKeys) return;

                  for (const key of queryKeys) {
                    const keyStr = JSON.stringify(key);

                    // Debounce invalidation
                    const existing = debounceTimers.current.get(keyStr);
                    if (existing) clearTimeout(existing);

                    debounceTimers.current.set(keyStr, setTimeout(() => {
                      if (cancelled) return;
                      debounceTimers.current.delete(keyStr);
                      queryClient.invalidateQueries({ queryKey: key });
                    }, getDebounceMs(table)));
                  }
                }
              )
              .subscribe((status: string) => {
                if (status === 'SUBSCRIBED') {
                  // Successfully subscribed — Realtime is working
                } else if (status === 'CHANNEL_ERROR') {
                  // Table might not have Realtime enabled — this is OK
                  // The polling fallback in QueryProvider handles data freshness
                  if (process.env.NODE_ENV === 'development') {
                    console.warn(`[Realtime] Could not subscribe to ${table}.${event} — Realtime may not be enabled for this table in Supabase Dashboard`);
                  }
                }
              });

            if (!cancelled) {
              channelsRef.current.push(channel);
            }
          }
        }
      } catch (err) {
        console.warn('[Realtime] Failed to initialize:', err);
      }
    }

    subscribe();

    return () => {
      cancelled = true;
      // Clear all debounce timers
      for (const timer of debounceTimers.current.values()) {
        clearTimeout(timer);
      }
      debounceTimers.current.clear();

      // Remove all channels
      for (const channel of channelsRef.current) {
        try {
          // Dynamically import to get supabase client for cleanup
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
          const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
          if (supabaseUrl && supabaseKey) {
            import('@supabase/supabase-js').then(({ createClient }) => {
              const supabase = createClient(supabaseUrl, supabaseKey);
              supabase.removeChannel(channel);
            });
          }
        } catch {
          // Cleanup best-effort
        }
      }
      channelsRef.current = [];
    };
  }, [user?.id, queryClient]);
}
