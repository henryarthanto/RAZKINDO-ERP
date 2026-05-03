'use client';

import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/stores/auth-store';

/**
 * SSE (Server-Sent Events) fallback if WebSocket is unavailable.
 * Lighter than WebSocket, suitable for STB with unstable network.
 *
 * Only activates if WebSocket has not connected after 10 seconds.
 */
export function useSSEFallback(
  isWsConnected: boolean,
  onEvent: (eventType: string, data: any) => void
) {
  const { token } = useAuthStore();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // If WebSocket is connected, close SSE and return
    if (isWsConnected) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }

    // Wait 10 seconds before activating SSE fallback
    const timer = setTimeout(() => {
      if (!token || esRef.current) return;

      const es = new EventSource(`/api/events/stream?token=${token}`);
      esRef.current = es;

      es.onmessage = (e) => {
        try {
          const { type, data } = JSON.parse(e.data);
          onEvent(type, data);
        } catch {
          // Ignore malformed messages
        }
      };

      es.onerror = () => {
        es.close();
        esRef.current = null;
      };
    }, 10_000);

    return () => {
      clearTimeout(timer);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [isWsConnected, token, onEvent]);
}
