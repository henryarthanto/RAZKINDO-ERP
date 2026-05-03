import { NextRequest, NextResponse } from 'next/server';
import { consistencyChecker } from '@/lib/consistency-checker';
import { enforceSuperAdmin } from '@/lib/require-auth';

// =====================================================================
// GET /api/system/consistency - Run all consistency checks
// POST /api/system/consistency - Run a specific check by name
// =====================================================================

export async function GET(request: NextRequest) {
  // SECURITY: Only super_admin can run system consistency checks
  const authResult = await enforceSuperAdmin(request);
  if (!authResult.success) return authResult.response;

  try {
    const results = await consistencyChecker.runAll();

    const allOk = results.every((r) => r.ok);
    const hasCritical = results.some((r) => !r.ok && r.severity === 'critical');
    const hasWarning = results.some((r) => !r.ok && r.severity === 'warning');

    return NextResponse.json({
      status: allOk ? 'healthy' : hasCritical ? 'critical' : hasWarning ? 'warning' : 'healthy',
      timestamp: new Date().toISOString(),
      totalChecks: results.length,
      passed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      checks: results,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // SECURITY: Only super_admin can run system consistency checks
  const authResult = await enforceSuperAdmin(request);
  if (!authResult.success) return authResult.response;

  try {
    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'Missing "name" field in request body' },
        { status: 400 }
      );
    }

    // If name is "all", run everything
    if (name === 'all') {
      const results = await consistencyChecker.runAll();
      return NextResponse.json({
        status: 'completed',
        timestamp: new Date().toISOString(),
        checks: results,
      });
    }

    const result = await consistencyChecker.runCheck(name);

    if (result.message.includes('not found')) {
      const available = consistencyChecker.listChecks();
      return NextResponse.json(
        {
          error: result.message,
          availableChecks: available,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      status: 'completed',
      timestamp: new Date().toISOString(),
      checkName: name,
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
