// =====================================================================
// MEMORY INIT — Server-side MemoryGuard initialization
//
// Auto-starts memory monitoring when imported on the server.
// Designed to be imported from instrumentation.ts (runs once at server start).
// =====================================================================

import { memoryGuard } from './memory-guard';

if (typeof window === 'undefined') {
  // Check every 2 minutes — less aggressive than 30s
  memoryGuard.start(120_000);

  // Register default cleanup callback for critical memory pressure
  memoryGuard.onCritical(() => {
    // Force garbage collection hint (Node.js only, requires --expose-gc flag)
    if (typeof globalThis !== 'undefined' && (globalThis as any).gc) {
      try {
        (globalThis as any).gc();
      } catch {
        // Silent — GC not available
      }
    }
  });
}
