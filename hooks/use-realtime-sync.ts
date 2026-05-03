'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocket } from '@/hooks/use-websocket';
import { useAuthStore } from '@/stores/auth-store';

import { WEBSOCKET } from '@/lib/stb-config';

// =====================================================================
// REALTIME SYNC HOOK - Bridges WebSocket events → TanStack Query cache
// When any user makes a change, all connected clients in the same
// unit/role automatically refresh their relevant data without polling.
//
// This eliminates the need for frequent polling and ensures all
// departments see changes in real-time.
//
// STB: Debounce times auto-configured from stb-config for 2GB RAM.
// =====================================================================

/**
 * Map of WebSocket events to TanStack Query keys that should be invalidated.
 * When a WS event is received, the corresponding query keys are invalidated,
 * triggering automatic refetch of fresh data from the server.
 *
 * IMPORTANT: Keys MUST match the exact queryKey arrays used in components.
 * Mismatched keys = stale data across all clients.
 */
const EVENT_TO_QUERY_KEYS: Record<string, string[][]> = {
  // Transaction events — invalidate transactions, dashboard, receivables, PWA orders
  'erp:transaction_update': [
    ['transactions'],
    ['dashboard'],
    ['receivables'],
    ['finance-requests'],
    ['pwa-pending-orders'],
    ['pwa-approved-unpaid-orders'],
    ['products', 'stock-movements'],
    ['sales-dashboard'],
    ['courier-dashboard'],
  ],

  // Payment events — invalidate transactions, dashboard, finance pools, receivables
  'erp:payment_update': [
    ['transactions'],
    ['dashboard'],
    ['receivables'],
    ['finance-pools'],
    ['pwa-approved-unpaid-orders'],
    ['sales-dashboard'],
  ],

  // Stock events — invalidate products, dashboard, asset value, stock movements
  'erp:stock_update': [
    ['products'],
    ['dashboard'],
    ['asset-value'],
    ['stock-movements'],
  ],

  // User events (registration/approval) — invalidate users list
  'erp:user_update': [
    ['users'],
  ],

  // Sales task events — invalidate tasks
  'erp:task_update': [
    ['sales-tasks'],
  ],

  // Finance request events — invalidate finance requests, dashboard, pools
  'erp:finance_update': [
    ['finance-requests'],
    ['dashboard'],
    ['finance-pools'],
  ],

  // Delivery events — invalidate transactions, courier dashboard, receivables
  'erp:delivery_update': [
    ['transactions'],
    ['dashboard'],
    ['receivables'],
    ['finance-pools'],
    ['courier-dashboard'],
  ],

  // Courier assignment — when sales assigns a courier to a new transaction
  'erp:courier_assignment': [
    ['courier-dashboard'],
    ['transactions'],
    ['deliveries'],
  ],

  // Salary events — invalidate salaries
  'erp:salary_update': [
    ['salaries'],
  ],

  // Customer events — invalidate customers list
  'erp:customer_update': [
    ['customers'],
  ],

  // Product events — invalidate products list
  'erp:product_update': [
    ['products'],
  ],

  // Receivable events — invalidate receivables
  'erp:receivable_update': [
    ['receivables'],
  ],

  // Courier events — invalidate transactions, dashboard
  'erp:courier_update': [
    ['transactions'],
    ['dashboard'],
  ],

  // New event notification — always refresh events list
  'erp:new_event': [
    ['events'],
  ],

  // Payment proof upload — refresh transactions and events
  'erp:payment_proof_update': [
    ['transactions'],
    ['events'],
    ['receivables'],
  ],

  // Global refresh — handled specially with queryClient.invalidateQueries()
  // and a longer debounce (see handler below)
  'erp:refresh_all': [],
};

/** Normal debounce: from STB config */
const INVALIDATION_DEBOUNCE_MS = WEBSOCKET.mediumDebounceMs;

/** Refresh-all debounce: from STB config */
const REFRESH_ALL_DEBOUNCE_MS = WEBSOCKET.refreshAllDebounceMs;

/**
 * Adaptive debounce: different debounce times for different event types.
 * Critical events (transactions, stock) need faster refresh.
 * Non-critical events can wait longer to reduce load.
 */
function getDebounceMs(event: string): number {
  // Critical events: short debounce for real-time UX
  if (['erp:transaction_update', 'erp:stock_update', 'erp:payment_proof_update'].includes(event)) {
    return WEBSOCKET.criticalDebounceMs;
  }
  // Dashboard events: medium debounce
  if (['erp:payment_update', 'erp:delivery_update', 'erp:new_event'].includes(event)) {
    return WEBSOCKET.mediumDebounceMs;
  }
  // Non-critical events: longer debounce to reduce load on STB
  return WEBSOCKET.nonCriticalDebounceMs;
}

/**
 * Hook that subscribes to WebSocket events and invalidates
 * TanStack Query cache keys for seamless real-time data sync
 * across all connected clients and departments.
 */
export function useRealtimeSync() {
  const queryClient = useQueryClient();
  const { user, token } = useAuthStore();
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const { on, off, isConnected } = useWebSocket({
    userId: user?.id || '',
    role: user?.role || '',
    unitId: user?.unitId || '',
    userName: user?.name || '',
    authToken: token || '',
    enabled: !!user?.id,
  });

  useEffect(() => {
    if (!isConnected || !user?.id) return;

    // FIX 1: Use closure to capture event name correctly.
    // socket.io's .on(event, handler) calls handler(data) — the event name
    // is NOT passed as first argument. Previously `handleEvent` received the
    // data payload as `event`, causing EVENT_TO_QUERY_KEYS lookup to always fail.
    const events = Object.keys(EVENT_TO_QUERY_KEYS);
    const handlers: ((data: any) => void)[] = [];

    for (const event of events) {
      // FIX 5: refresh_all uses queryClient.invalidateQueries() without specific keys
      // (TanStack Query batches these more efficiently) and a longer 2s debounce
      if (event === 'erp:refresh_all') {
        const handler = (_data: any) => {
          const keyStr = '__refresh_all__';
          const existing = debounceTimers.current.get(keyStr);
          if (existing) clearTimeout(existing);

          debounceTimers.current.set(keyStr, setTimeout(() => {
            debounceTimers.current.delete(keyStr);
            queryClient.invalidateQueries();
          }, REFRESH_ALL_DEBOUNCE_MS));
        };
        handlers.push(handler);
        on(event, handler);
      } else {
        const queryKeys = EVENT_TO_QUERY_KEYS[event];
        if (!queryKeys) continue;

        const handler = (_data: any) => {
          for (const key of queryKeys) {
            const keyStr = JSON.stringify(key);

            // Debounce: use adaptive debounce based on event type
            const existing = debounceTimers.current.get(keyStr);
            if (existing) clearTimeout(existing);

            debounceTimers.current.set(keyStr, setTimeout(() => {
              debounceTimers.current.delete(keyStr);
              queryClient.invalidateQueries({ queryKey: key });
            }, getDebounceMs(event)));
          }
        };
        handlers.push(handler);
        on(event, handler);
      }
    }

    // Cleanup
    return () => {
      for (let i = 0; i < events.length; i++) {
        off(events[i], handlers[i]);
      }
      // Clear all debounce timers
      for (const timer of debounceTimers.current.values()) {
        clearTimeout(timer);
      }
      debounceTimers.current.clear();
    };
  }, [isConnected, user?.id, queryClient, on, off]);
}
