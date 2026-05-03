'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';

// =====================================================================
// WEBSOCKET HOOK - Real-time connection to ERP WebSocket service
// Provides auto-reconnect, auth, event subscription, and online presence
//
// AUTO-DETECTION LOGIC:
//   - If NEXT_PUBLIC_WS_URL is set (build-time), use it directly
//   - Otherwise, detect environment:
//     a) Try XTransformPort pattern (works with Caddy gateway on z.ai)
//     b) Fall back to direct port connection (works on STB without proxy)
//
// This ensures WebSocket works in BOTH development (z.ai) and production
// (STB direct access) environments without code changes.
// =====================================================================

interface UseWebSocketOptions {
  userId: string;
  role: string;
  unitId?: string;
  userName?: string;
  authToken?: string;
  enabled?: boolean;
}

interface UseWebSocketReturn {
  socket: Socket | null;
  isConnected: boolean;
  onlineCount: number;
  onlineUserIds: string[];
  emit: (event: string, data: any) => void;
  on: (event: string, handler: (...args: any[]) => void) => void;
  off: (event: string, handler: (...args: any[]) => void) => void;
}

// Singleton socket to prevent multiple connections
let _socket: Socket | null = null;
let _lastAuthData: { userId: string; role: string; unitId: string; userName: string; authToken: string } | null = null;
let _refCount = 0;
let _connectionMode: 'xtransform' | 'direct' | 'custom' = 'xtransform';
let _directPortAttempted = false;

/** The port where the event-queue service runs */
const WS_SERVICE_PORT = 3004;

/**
 * Determine the Socket.io connection URL based on environment.
 *
 * Priority:
 *   1. NEXT_PUBLIC_WS_URL (explicit override — e.g., "http://192.168.100.64:3004")
 *   2. XTransformPort pattern (z.ai gateway — "/?XTransformPort=3004")
 *   3. Direct connection fallback (STB — "http://{host}:{port}")
 */
function getSocketUrl(): { url: string; path: string; mode: 'xtransform' | 'direct' | 'custom' } {
  // 1. Explicit custom URL (set at build time via NEXT_PUBLIC_WS_URL)
  const customUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (customUrl) {
    return { url: customUrl, path: '/', mode: 'custom' };
  }

  // 2. XTransformPort pattern (works with Caddy gateway)
  // This is the default for z.ai development environment
  return { url: '/?XTransformPort=' + WS_SERVICE_PORT, path: '/', mode: 'xtransform' };
}

/**
 * Try connecting to the WebSocket service directly on the WS port.
 * Used as a fallback when XTransformPort pattern fails (no Caddy proxy).
 */
function getDirectUrl(): { url: string; path: string } {
  if (typeof window === 'undefined') {
    return { url: `http://127.0.0.1:${WS_SERVICE_PORT}`, path: '/' };
  }
  // Use the same hostname the browser is on, but on the WS service port
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  return { url: `${protocol}//${window.location.hostname}:${WS_SERVICE_PORT}`, path: '/' };
}

function createSocket(url: string, path: string): Socket {
  const socket = io(url, {
    path,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,     // ✅ STB: no limit — must always reconnect
    reconnectionDelay: 1000,           // ✅ Start from 1s (was 2000)
    reconnectionDelayMax: 30000,       // ✅ Max 30s backoff (was 10000)
    timeout: 30000,                    // ✅ 30s for slow STB WiFi (was 20000)
    autoConnect: true,
    // @ts-expect-error - pingInterval is a valid socket.io option but not in types
    pingInterval: 25000,               // ✅ Ping every 25s to detect dead connections
    pingTimeout: 60000,                // ✅ 60s ping timeout
  });

  // Graceful fallback: stop reconnecting after max attempts exhausted
  socket.on('reconnect_failed', () => {
    console.warn(
      '[WS] Max reconnection attempts reached. WebSocket service may be unavailable on this deployment.',
    );

    // If XTransformPort mode failed, try direct port connection
    if (_connectionMode === 'xtransform' && !_directPortAttempted) {
      _directPortAttempted = true;
      console.info('[WS] Trying direct port connection fallback...');
      _socket?.disconnect();
      _socket = null;

      const direct = getDirectUrl();
      _connectionMode = 'direct';
      _socket = createSocket(direct.url, direct.path);

      // Re-register if we have auth data
      _socket.on('connect', () => {
        console.log('[WS] Direct connection established:', _socket?.id);
        if (_lastAuthData) {
          _socket?.emit('register', {
            userId: _lastAuthData.userId,
            roles: [_lastAuthData.role],
            unitId: _lastAuthData.unitId,
            userName: _lastAuthData.userName,
          });
        }
      });

      _socket.on('disconnect', (reason) => {
        console.log('[WS] Direct disconnected:', reason);
      });

      _socket.on('connect_error', (err) => {
        console.warn('[WS] Direct connection error:', err.message);
      });

      _socket.connect();
      return;
    }

    console.info(
      '[WS] Real-time features are disabled. You can refresh the page to retry.',
    );
  });

  // Global connection logging — re-auth on reconnect
  socket.on('connect', () => {
    console.log('[WS] Connected:', socket.id, `(mode: ${_connectionMode})`);
    if (_lastAuthData) {
      socket.emit('register', {
        userId: _lastAuthData.userId,
        roles: [_lastAuthData.role],
        unitId: _lastAuthData.unitId,
        userName: _lastAuthData.userName,
      });
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('[WS] Disconnected:', reason);
  });

  socket.on('connect_error', (err) => {
    console.warn('[WS] Connection error:', err.message);
  });

  return socket;
}

function getOrCreateSocket(): Socket {
  if (_socket) return _socket;

  const { url, path, mode } = getSocketUrl();
  _connectionMode = mode;
  _directPortAttempted = false;

  _socket = createSocket(url, path);
  return _socket;
}

/** Force-disconnect the singleton socket (e.g., on logout) */
export function disconnectWebSocket(): void {
  if (_socket) {
    console.log('[WS] Force disconnecting singleton socket');
    _socket.disconnect();
    _socket = null;
    _lastAuthData = null;
    _refCount = 0;
    _directPortAttempted = false;
  }
}

export function useWebSocket(options: UseWebSocketOptions): UseWebSocketReturn {
  const { userId, role, unitId = '', userName = '', authToken = '', enabled = true } = options;
  const [isConnected, setIsConnected] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  // Support multiple handlers per event using Set
  const handlersRef = useRef<Map<string, Set<(...args: any[]) => void>>>(new Map());

  useEffect(() => {
    if (!enabled || !userId) return;

    const socket = getOrCreateSocket();
    _refCount++;

    // Store auth data for reconnection
    _lastAuthData = { userId, role, unitId, userName, authToken };

    // Register with server using 'register' event (matches server-side listener)
    const registerWithServer = () => {
      socket.emit('register', {
        userId,
        roles: [role],
        unitId,
        userName,
      });
    };

    // Auth immediately if connected, otherwise the global 'connect' handler will do it
    if (socket.connected) {
      registerWithServer();
    }

    // Track connection state
    const onConnect = () => {
      setIsConnected(true);
      // Re-auth on every reconnection
      registerWithServer();
    };
    const onDisconnect = () => setIsConnected(false);
    const onPresence = (data: { onlineCount: number; onlineUserIds: string[] }) => {
      setOnlineCount(data.onlineCount);
      setOnlineUserIds(data.onlineUserIds);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('presence:update', onPresence);

    // Re-attach all registered handlers
    handlersRef.current.forEach((handlerSet, event) => {
      handlerSet.forEach(handler => socket.on(event, handler));
    });

    return () => {
      _refCount--;
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('presence:update', onPresence);

      // Remove all registered handlers
      handlersRef.current.forEach((handlerSet, event) => {
        handlerSet.forEach(handler => socket.off(event, handler));
      });

      if (_refCount <= 0 && _socket) {
        console.log('[WS] Destroying singleton socket');
        _socket.disconnect();
        _socket = null;
        _lastAuthData = null;
        _refCount = 0;
        _directPortAttempted = false;
      }
    };
  }, [enabled, userId, role, unitId, userName, authToken]);

  const emit = useCallback((event: string, data: any) => {
    if (_socket?.connected) {
      _socket.emit(event, data);
    }
  }, []);

  const on = useCallback((event: string, handler: (...args: any[]) => void) => {
    // Support multiple handlers per event
    if (!handlersRef.current.has(event)) {
      handlersRef.current.set(event, new Set());
    }
    handlersRef.current.get(event)!.add(handler);
    if (_socket?.connected) {
      _socket.on(event, handler);
    }
  }, []);

  const off = useCallback((event: string, handler: (...args: any[]) => void) => {
    const handlerSet = handlersRef.current.get(event);
    if (handlerSet) {
      handlerSet.delete(handler);
      if (handlerSet.size === 0) {
        handlersRef.current.delete(event);
      }
    }
    if (_socket?.connected) {
      _socket.off(event, handler);
    }
  }, []);

  return {
    socket: _socket,
    isConnected,
    onlineCount,
    onlineUserIds,
    emit,
    on,
    off,
  };
}
