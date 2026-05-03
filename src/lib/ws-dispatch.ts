// =====================================================================
// WS DISPATCH — WebSocket Real-time Notification Stubs
//
// Fire-and-forget functions for broadcasting real-time updates via
// WebSocket to connected clients.
//
// Currently implemented as stubs (no-op) since the WebSocket mini-service
// is not yet deployed. All functions are safe to call — they log the
// event and return immediately without crashing.
//
// When the WebSocket service is ready, replace the stub implementations
// with actual Socket.io/WS emit calls.
// =====================================================================

type WsEventData = Record<string, unknown>;

/**
 * Helper: safe no-op dispatch.
 * Logs event name in development for debugging.
 * Silently succeeds in production.
 */
function dispatch(eventName: string, _data?: WsEventData): void {
  if (process.env.NODE_ENV === 'development') {
    // Debug logging only in dev — prevent console noise in production
    if (process.env.DEBUG_WS === 'true') {
      console.log(`[WS-Dispatch] ${eventName}`, _data ? `(keys: ${Object.keys(_data).join(', ')})` : '');
    }
  }
}

// ─── Transaction ────────────────────────────────────────────────────
export function wsTransactionUpdate(data?: WsEventData): void {
  dispatch('transaction:update', data);
}

// ─── Stock ──────────────────────────────────────────────────────────
export function wsStockUpdate(data?: WsEventData): void {
  dispatch('stock:update', data);
}

// ─── Payment ────────────────────────────────────────────────────────
export function wsPaymentUpdate(data?: WsEventData): void {
  dispatch('payment:update', data);
}

// ─── Receivable ─────────────────────────────────────────────────────
export function wsReceivableUpdate(data?: WsEventData): void {
  dispatch('receivable:update', data);
}

// ─── Delivery ───────────────────────────────────────────────────────
export function wsDeliveryUpdate(data?: WsEventData): void {
  dispatch('delivery:update', data);
}

// ─── Finance ────────────────────────────────────────────────────────
export function wsFinanceUpdate(data?: WsEventData): void {
  dispatch('finance:update', data);
}

// ─── Courier ────────────────────────────────────────────────────────
export function wsCourierUpdate(data?: WsEventData): void {
  dispatch('courier:update', data);
}

// ─── Customer ───────────────────────────────────────────────────────
export function wsCustomerUpdate(data?: WsEventData): void {
  dispatch('customer:update', data);
}

// ─── User ───────────────────────────────────────────────────────────
export function wsUserUpdate(data?: WsEventData): void {
  dispatch('user:update', data);
}

// ─── Salary ─────────────────────────────────────────────────────────
export function wsSalaryUpdate(data?: WsEventData): void {
  dispatch('salary:update', data);
}

// ─── Task ───────────────────────────────────────────────────────────
export function wsTaskUpdate(data?: WsEventData): void {
  dispatch('task:update', data);
}

// ─── Generic ────────────────────────────────────────────────────────
export function wsEmit(event: string, data?: WsEventData): void {
  dispatch(event, data);
}

export function wsNotifyAll(data?: WsEventData): void {
  dispatch('notify:all', data);
}

export function wsRefreshAll(data?: WsEventData): void {
  dispatch('refresh:all', data);
}
