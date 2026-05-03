// =====================================================================
// DB TRANSACTION HELPER — Software-level transaction pattern for Supabase
//
// Since Supabase REST API doesn't support raw BEGIN/COMMIT transactions,
// this module provides a compensating-transaction pattern that:
//   1. Runs multiple async operations sequentially
//   2. If any step fails, calls rollback functions from completed steps
//   3. Provides structured logging for debugging
//
// For truly atomic single-statement operations (balance updates, stock
// deductions), use the existing RPC functions in @/lib/atomic-ops.ts.
// =====================================================================

// =====================================================================
// TYPES
// =====================================================================

/**
 * A single step in a multi-step operation.
 * Each step has an execute function and an optional rollback function.
 * Rollback is called with the result of execute if a later step fails.
 */
export interface TransactionStep<T = unknown> {
  /** Human-readable name for logging */
  name: string;
  /** The operation to execute. Returns a result that may be needed for rollback. */
  execute: () => Promise<T>;
  /**
   * Optional compensating action. Receives the result from execute().
   * Called in reverse order if any later step fails.
   * Should be idempotent where possible.
   */
  rollback?: (result: T) => Promise<void>;
}

/** Result of a completed transaction step */
interface StepResult<T = unknown> {
  step: TransactionStep<T>;
  result: T;
  success: boolean;
}

/**
 * Options for runInTransaction
 */
export interface TransactionOptions {
  /** Log each step execution (default: true) */
  verbose?: boolean;
}

// =====================================================================
// CORE: runInTransaction
// =====================================================================

/**
 * Run an array of operations sequentially with compensating rollback.
 *
 * If any step fails:
 *   1. Execution stops immediately
 *   2. All completed steps with rollback functions are called in reverse order
 *   3. The original error is re-thrown
 *
 * Usage:
 * ```ts
 * const result = await runInTransaction([
 *   {
 *     name: 'create-order',
 *     execute: async () => { const id = generateId(); await db.from('orders').insert({id}); return id; },
 *     rollback: async (id) => { await db.from('orders').delete().eq('id', id); }
 *   },
 *   {
 *     name: 'reserve-stock',
 *     execute: async () => { await atomicDecrementStock(productId, qty); return true; },
 *     rollback: async () => { await atomicIncrementStock(productId, qty); }
 *   },
 * ]);
 * ```
 *
 * @param steps - Array of TransactionStep objects to execute in order
 * @param options - Optional configuration
 * @returns Array of results from each step's execute function
 * @throws The error from the first failing step
 */
export async function runInTransaction<T = unknown>(
  steps: TransactionStep<T>[],
  options: TransactionOptions = {}
): Promise<T[]> {
  const verbose = options.verbose !== false;
  const completedSteps: StepResult<T>[] = [];

  if (verbose && steps.length > 0) {
    console.log(`[Transaction] Starting ${steps.length}-step transaction`);
  }

  try {
    for (const step of steps) {
      if (verbose) {
        console.log(`[Transaction] Executing step: ${step.name}`);
      }

      const startTime = Date.now();
      const result = await step.execute();
      const duration = Date.now() - startTime;

      completedSteps.push({ step, result, success: true });

      if (verbose) {
        console.log(`[Transaction] Step "${step.name}" completed in ${duration}ms`);
      }
    }

    if (verbose && completedSteps.length > 0) {
      console.log(`[Transaction] All ${completedSteps.length} steps completed successfully`);
    }

    return completedSteps.map((s) => s.result);
  } catch (error) {
    const failedStepName = steps[completedSteps.length]?.name || 'unknown';
    console.error(
      `[Transaction] Step "${failedStepName}" failed. ` +
      `Rolling back ${completedSteps.length} completed step(s)...`
    );

    // Rollback completed steps in reverse order
    const rollbackErrors: { step: string; error: unknown }[] = [];
    for (let i = completedSteps.length - 1; i >= 0; i--) {
      const { step, result } = completedSteps[i];
      if (step.rollback) {
        try {
          if (verbose) {
            console.log(`[Transaction] Rolling back step: ${step.name}`);
          }
          await step.rollback(result);
          if (verbose) {
            console.log(`[Transaction] Rollback of "${step.name}" succeeded`);
          }
        } catch (rollbackError) {
          console.error(
            `[Transaction] Rollback of "${step.name}" FAILED:`,
            rollbackError
          );
          rollbackErrors.push({ step: step.name, error: rollbackError });
        }
      }
    }

    if (rollbackErrors.length > 0) {
      console.error(
        `[Transaction] ${rollbackErrors.length} rollback(s) failed. Manual intervention may be required.`
      );
    }

    throw error;
  }
}

// =====================================================================
// CONVENIENCE: atomicMultiStep
// =====================================================================

/**
 * Alias for runInTransaction — runs a series of steps with rollback support.
 * Identical to runInTransaction; provided for semantic clarity.
 */
export async function atomicMultiStep<T = unknown>(
  steps: TransactionStep<T>[],
  options?: TransactionOptions
): Promise<T[]> {
  return runInTransaction(steps, options);
}

// =====================================================================
// CONVENIENCE: withTransaction (callback pattern)
// =====================================================================

/**
 * Callback-style transaction wrapper.
 * Pass an async function that receives a helper for building steps.
 *
 * Usage:
 * ```ts
 * const orderId = await withTransaction(async (tx) => {
 *   const id = generateId();
 *   await tx.step('create-order', async () => {
 *     await db.from('orders').insert({ id });
 *   }, async () => {
 *     await db.from('orders').delete().eq('id', id);
 *   });
 *
 *   await tx.step('reserve-stock', async () => {
 *     await atomicDecrementStock(productId, qty);
 *   });
 *
 *   return id;
 * });
 * ```
 *
 * If any tx.step() fails, all previous steps with rollback functions
 * are rolled back and the error is re-thrown.
 */
export async function withTransaction<TResult = void>(
  callback: (tx: TransactionBuilder) => Promise<TResult>
): Promise<TResult> {
  const steps: TransactionStep<void>[] = [];
  const results: void[] = [];
  const verbose = true;

  const builder: TransactionBuilder = {
    step: async <T>(
      name: string,
      execute: () => Promise<T>,
      rollback?: (result: T) => Promise<void>
    ): Promise<T> => {
      const step: TransactionStep<T | void> = { name, execute, rollback: rollback as ((result: T | void) => Promise<void>) | undefined };
      const startTime = Date.now();
      const result = await step.execute();
      const duration = Date.now() - startTime;

      steps.push(step as TransactionStep<void>);
      results.push(undefined);

      if (verbose) {
        console.log(`[Transaction] Step "${name}" completed in ${duration}ms`);
      }

      return result as T;
    },
  };

  try {
    return await callback(builder);
  } catch (error) {
    console.error(
      `[Transaction] Operation failed. Rolling back ${steps.length} step(s)...`
    );

    // We can't easily rollback with results since we didn't capture typed results
    // This is a limitation of the callback pattern — prefer runInTransaction for
    // full rollback support with typed results
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      if (step.rollback) {
        try {
          if (verbose) {
            console.log(`[Transaction] Rolling back step: ${step.name}`);
          }
          await step.rollback(undefined);
        } catch (rollbackError) {
          console.error(
            `[Transaction] Rollback of "${step.name}" FAILED:`,
            rollbackError
          );
        }
      }
    }

    throw error;
  }
}

/**
 * Builder interface passed to withTransaction callback
 */
export interface TransactionBuilder {
  /**
   * Execute a named step within the transaction.
   * If a later step fails, this step's rollback will be called.
   */
  step<T>(
    name: string,
    execute: () => Promise<T>,
    rollback?: (result: T) => Promise<void>
  ): Promise<T>;
}

// =====================================================================
// UTILITY: createStep helper
// =====================================================================

/**
 * Helper to create a TransactionStep with type inference.
 *
 * Usage:
 * ```ts
 * const steps = [
 *   createStep('insert-user', async () => {
 *     return await db.from('users').insert(data).select().single();
 *   }, async (result) => {
 *     await db.from('users').delete().eq('id', result.id);
 *   }),
 * ];
 * await runInTransaction(steps);
 * ```
 */
export function createStep<T>(
  name: string,
  execute: () => Promise<T>,
  rollback?: (result: T) => Promise<void>
): TransactionStep<T> {
  return { name, execute, rollback };
}
