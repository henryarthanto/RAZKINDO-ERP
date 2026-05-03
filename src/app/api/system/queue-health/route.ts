// =====================================================================
// WEBSOCKET EVENT-QUEUE HEALTH CHECK
// GET /api/system/queue-health
//
// Proxies health & status requests to the event-queue service (port 3004)
// and returns a unified response indicating availability, queue stats,
// connected clients, and health info.
//
// Environment handling:
//   - z.ai (Caddy gateway): uses ?XTransformPort=3004 query param
//   - STB (direct): uses http://127.0.0.1:3004
// =====================================================================

import { NextRequest, NextResponse } from 'next/server';
import { enforceSuperAdmin } from '@/lib/require-auth';

const WS_SERVICE_PORT = 3004;
const WS_SECRET = process.env.WS_SECRET || '';

/** Build the base URL for the event-queue service based on environment. */
function getServiceBaseUrl(request: NextRequest): string {
  // Detect if we're behind the Caddy gateway (z.ai) by checking the
  // incoming request's origin. On z.ai, requests go through Caddy which
  // supports the XTransformPort query param to proxy to internal ports.
  // On STB, we can hit the service directly on localhost.
  const host = request.headers.get('host') || '';
  const protocol = request.headers.get('x-forwarded-proto') || 'http';

  // If the request already uses XTransformPort, we're in the Caddy env
  if (request.nextUrl.searchParams.has('XTransformPort')) {
    return `${protocol}://${host}`;
  }

  // Default: try direct localhost access (works on STB and in most server-side contexts)
  return `http://127.0.0.1:${WS_SERVICE_PORT}`;
}

/** Append XTransformPort param for Caddy gateway environments. */
function buildServiceUrl(baseUrl: string, path: string, useXTransform: boolean): string {
  const url = new URL(path, baseUrl);
  if (useXTransform) {
    url.searchParams.set('XTransformPort', String(WS_SERVICE_PORT));
  }
  return url.toString();
}

/** Fetch a service endpoint with Bearer auth, returning parsed JSON or null on failure. */
async function fetchService(path: string, useXTransform: boolean, baseUrl: string): Promise<{ data: any; latencyMs: number } | null> {
  const url = buildServiceUrl(baseUrl, path, useXTransform);
  const start = performance.now();

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${WS_SECRET}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(5000), // 5s timeout
    });

    const latencyMs = Math.round(performance.now() - start);

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    return { data, latencyMs };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  // ── Auth + super_admin check ──────────────────────────────────────
  const authResult = await enforceSuperAdmin(request);
  if (!authResult.success) {
    return authResult.response;
  }

  // ── Determine service URL strategy ─────────────────────────────────
  const baseUrl = getServiceBaseUrl(request);

  // Try with XTransformPort first (z.ai / Caddy), then fall back to direct
  let healthResult = await fetchService('/api/health', true, baseUrl);
  let queueResult = await fetchService('/api/queue/status', true, baseUrl);
  let usedXTransform = true;

  // If XTransformPort didn't work, try direct access
  if (!healthResult && !queueResult) {
    const directUrl = `http://127.0.0.1:${WS_SERVICE_PORT}`;
    healthResult = await fetchService('/api/health', false, directUrl);
    queueResult = await fetchService('/api/queue/status', false, directUrl);
    usedXTransform = false;
  }

  // ── Build response ─────────────────────────────────────────────────
  const available = !!(healthResult || queueResult);

  if (!available) {
    return NextResponse.json({
      available: false,
      queue: null,
      error: 'Event-queue service unreachable on port ' + WS_SERVICE_PORT,
    }, { status: 503 });
  }

  return NextResponse.json({
    available: true,
    queue: queueResult?.data ?? null,
    health: healthResult?.data ?? null,
    latencyMs: {
      health: healthResult?.latencyMs ?? null,
      queue: queueResult?.latencyMs ?? null,
    },
    error: null,
  });
}
