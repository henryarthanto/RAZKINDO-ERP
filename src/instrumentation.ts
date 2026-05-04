// =====================================================================
// Next.js Instrumentation — Server Startup Hooks
//
// Auto-deploys PostgreSQL RPC functions on server start.
// This ensures atomic operations (decrement_stock, increment_stock, etc.)
// are available in the database before any API routes handle requests.
// =====================================================================

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Deploy RPC functions in background — don't block server startup
    ensureRpcFunctions().catch((err) => {
      console.error('[instrumentation] ensureRpcFunctions failed (non-blocking):', err);
    });

    // Prevent unhandled promise rejections from crashing the server
    process.on('unhandledRejection', (reason, promise) => {
      console.error('[instrumentation] UNHANDLED REJECTION (server protected):', reason);
    });

    // Prevent uncaught exceptions from crashing the server
    process.on('uncaughtException', (err) => {
      console.error('[instrumentation] UNCAUGHT EXCEPTION (server protected):', err);
    });
  }
}

async function ensureRpcFunctions() {
  try {
    const { ensureRpcFunctions: deploy } = await import('@/lib/ensure-rpc');
    await deploy();
  } catch (error) {
    console.error('[instrumentation] Failed to import/deploy RPC functions:', error);
  }
}
