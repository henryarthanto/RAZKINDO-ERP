// =====================================================================
// READINESS PROBE ENDPOINT
// GET /api/health/ready
//
// Lightweight endpoint for load balancer / orchestrator health checks.
// Returns 200 with a simple body when the process is alive.
// =====================================================================

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ status: 'ok' });
}
