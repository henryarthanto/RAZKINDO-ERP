// =====================================================================
// CONSISTENCY CHECKER - Periodic Data Integrity Checker
//
// Runs consistency checks on the ERP database to detect:
// - Pool balance vs physical funds mismatch
// - Transaction payment status inconsistencies
// - Orphaned records
// - Negative balances
//
// Can be triggered via API or run as a cron job.
// =====================================================================

import { supabaseAdmin } from './supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConsistencyCheck {
  name: string;
  check(): Promise<{ ok: boolean; message: string; details?: unknown }>;
  severity: 'critical' | 'warning' | 'info';
}

interface CheckResult {
  checkName: string;
  ok: boolean;
  message: string;
  severity: string;
  details?: unknown;
}

// ---------------------------------------------------------------------------
// ConsistencyChecker Class
// ---------------------------------------------------------------------------

export class ConsistencyChecker {
  private checks: ConsistencyCheck[] = [];

  /** Register a new consistency check */
  register(check: ConsistencyCheck): void {
    // Don't duplicate
    const idx = this.checks.findIndex((c) => c.name === check.name);
    if (idx !== -1) {
      this.checks[idx] = check;
    } else {
      this.checks.push(check);
    }
  }

  /** Run all registered checks */
  async runAll(): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    for (const check of this.checks) {
      try {
        const result = await check.check();
        results.push({
          checkName: check.name,
          ok: result.ok,
          message: result.message,
          severity: check.severity,
          details: result.details,
        });
      } catch (err) {
        results.push({
          checkName: check.name,
          ok: false,
          message: `Check failed with error: ${err instanceof Error ? err.message : String(err)}`,
          severity: check.severity,
        });
      }
    }
    return results;
  }

  /** Run a single check by name */
  async runCheck(name: string): Promise<{ ok: boolean; message: string }> {
    const check = this.checks.find((c) => c.name === name);
    if (!check) {
      return { ok: false, message: `Check "${name}" not found` };
    }
    try {
      const result = await check.check();
      return { ok: result.ok, message: result.message };
    } catch (err) {
      return { ok: false, message: `Check failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /** Get list of all registered check names */
  listChecks(): { name: string; severity: string }[] {
    return this.checks.map((c) => ({ name: c.name, severity: c.severity }));
  }
}

// ---------------------------------------------------------------------------
// Default Check Implementations
// ---------------------------------------------------------------------------

/**
 * Check 1: Transaction payment status consistency
 * For transactions with paymentStatus = 'paid', verify paidAmount matches sum of payments.
 */
const paymentStatusCheck: ConsistencyCheck = {
  name: 'payment_status_consistency',
  severity: 'critical',
  async check() {
    // Fetch transactions marked as paid — use snake_case column names (PostgREST)
    const { data: paidTx, error } = await supabaseAdmin
      .from('transactions')
      .select('id, invoice_no, total, paid_amount, remaining_amount, payment_status')
      .eq('payment_status', 'paid')
      .neq('total', 0)
      .limit(500);

    if (error) {
      return { ok: false, message: `DB Error: ${error.message}` };
    }

    if (!paidTx || paidTx.length === 0) {
      return { ok: true, message: 'No paid transactions to verify' };
    }

    const issues: { invoiceNo: string; expected: number; actual: number }[] = [];

    // Fetch payment sums for these transactions
    const txIds = paidTx.map((t) => t.id);
    const { data: paymentSums } = await supabaseAdmin
      .from('payments')
      .select('transaction_id, amount')
      .in('transaction_id', txIds);

    const sumByTx = new Map<string, number>();
    if (paymentSums) {
      for (const p of paymentSums) {
        sumByTx.set(p.transaction_id, (sumByTx.get(p.transaction_id) || 0) + (p.amount || 0));
      }
    }

    for (const tx of paidTx) {
      const paymentSum = sumByTx.get(tx.id) || 0;
      if (Math.abs(paymentSum - (tx.paid_amount || 0)) > 0.01) {
        issues.push({
          invoiceNo: tx.invoice_no,
          expected: tx.paid_amount,
          actual: paymentSum,
        });
      }
      if (Math.abs(tx.remaining_amount || 0) > 0.01) {
        issues.push({
          invoiceNo: `${tx.invoice_no} (remaining)`,
          expected: 0,
          actual: tx.remaining_amount,
        });
      }
    }

    if (issues.length > 0) {
      return {
        ok: false,
        message: `Found ${issues.length} payment status inconsistency(ies)`,
        details: issues,
      };
    }

    return { ok: true, message: `All ${paidTx.length} paid transactions have consistent payment data` };
  },
};

/**
 * Check 2: Orphaned transaction items (items without valid transactions)
 */
const orphanedItemsCheck: ConsistencyCheck = {
  name: 'orphaned_transaction_items',
  severity: 'warning',
  async check() {
    // Get all transaction IDs (limited to prevent memory issues)
    const { data: transactions, error: txError } = await supabaseAdmin
      .from('transactions')
      .select('id')
      .limit(10000);

    if (txError) {
      return { ok: false, message: `DB Error: ${txError.message}` };
    }

    const txIds = new Set(transactions?.map((t) => t.id) || []);

    // Get all transaction items (use snake_case column names)
    const { data: items, error: itemError } = await supabaseAdmin
      .from('transaction_items')
      .select('id, transaction_id, product_name')
      .limit(10000);

    if (itemError) {
      return { ok: false, message: `DB Error: ${itemError.message}` };
    }

    const orphaned = items?.filter((item) => !txIds.has(item.transaction_id)) || [];

    if (orphaned.length > 0) {
      return {
        ok: false,
        message: `Found ${orphaned.length} orphaned transaction item(s)`,
        details: orphaned.map((o) => ({ id: o.id, transaction_id: o.transaction_id, product_name: o.product_name })),
      };
    }

    return { ok: true, message: `No orphaned transaction items found (${items?.length || 0} items checked)` };
  },
};

/**
 * Check 3: Negative bank account balances
 */
const negativeBankBalanceCheck: ConsistencyCheck = {
  name: 'negative_bank_balances',
  severity: 'warning',
  async check() {
    // Use snake_case column names (PostgREST)
    const { data: accounts, error } = await supabaseAdmin
      .from('bank_accounts')
      .select('id, name, bank_name, account_no, balance, is_active')
      .lt('balance', 0);

    if (error) {
      return { ok: false, message: `DB Error: ${error.message}` };
    }

    if (!accounts || accounts.length === 0) {
      return { ok: true, message: 'No bank accounts with negative balances' };
    }

    return {
      ok: false,
      message: `Found ${accounts.length} bank account(s) with negative balance`,
      details: accounts.map((a) => ({ id: a.id, name: `${a.bank_name} - ${a.name}`, accountNo: a.account_no, balance: a.balance })),
    };
  },
};

/**
 * Check 4: Negative cash box balances
 */
const negativeCashBoxBalanceCheck: ConsistencyCheck = {
  name: 'negative_cashbox_balances',
  severity: 'warning',
  async check() {
    // Use snake_case column names (PostgREST)
    const { data: boxes, error } = await supabaseAdmin
      .from('cash_boxes')
      .select('id, name, unit_id, balance, is_active');

    if (error) {
      return { ok: false, message: `DB Error: ${error.message}` };
    }

    const negative = boxes?.filter((b) => (b.balance || 0) < 0) || [];

    if (negative.length === 0) {
      return { ok: true, message: `No cash boxes with negative balances (${boxes?.length || 0} checked)` };
    }

    return {
      ok: false,
      message: `Found ${negative.length} cash box(es) with negative balance`,
      details: negative.map((b) => ({ id: b.id, name: b.name, unit_id: b.unit_id, balance: b.balance })),
    };
  },
};

/**
 * Check 5: Courier cash negative balances
 */
const negativeCourierCashCheck: ConsistencyCheck = {
  name: 'negative_courier_cash',
  severity: 'warning',
  async check() {
    // Use snake_case column names (PostgREST)
    const { data: courierCash, error } = await supabaseAdmin
      .from('courier_cash')
      .select('id, courier_id, unit_id, balance, total_collected, total_handover')
      .lt('balance', 0);

    if (error) {
      return { ok: false, message: `DB Error: ${error.message}` };
    }

    if (!courierCash || courierCash.length === 0) {
      return { ok: true, message: 'No courier cash with negative balances' };
    }

    return {
      ok: false,
      message: `Found ${courierCash.length} courier cash record(s) with negative balance`,
      details: courierCash.map((c) => ({ id: c.id, courier_id: c.courier_id, unit_id: c.unit_id, balance: c.balance })),
    };
  },
};

/**
 * Check 6: Receivable payment status consistency
 * Receivables with status 'paid' should have remainingAmount = 0
 */
const receivableStatusCheck: ConsistencyCheck = {
  name: 'receivable_payment_consistency',
  severity: 'warning',
  async check() {
    // Use snake_case column names (PostgREST)
    const { data: paidReceivables, error } = await supabaseAdmin
      .from('receivables')
      .select('id, transaction_id, total_amount, paid_amount, remaining_amount, status')
      .eq('status', 'paid')
      .limit(500);

    if (error) {
      return { ok: false, message: `DB Error: ${error.message}` };
    }

    if (!paidReceivables || paidReceivables.length === 0) {
      return { ok: true, message: 'No paid receivables to verify' };
    }

    const issues = paidReceivables.filter(
      (r) => Math.abs(r.remaining_amount || 0) > 0.01 || Math.abs((r.paid_amount || 0) - (r.total_amount || 0)) > 0.01
    );

    if (issues.length > 0) {
      return {
        ok: false,
        message: `Found ${issues.length} paid receivable(s) with inconsistent amounts`,
        details: issues.map((r) => ({
          id: r.id,
          transaction_id: r.transaction_id,
          total: r.total_amount,
          paid: r.paid_amount,
          remaining: r.remaining_amount,
        })),
      };
    }

    return { ok: true, message: `All ${paidReceivables.length} paid receivables have consistent amounts` };
  },
};

// ---------------------------------------------------------------------------
// Singleton with pre-registered checks
// ---------------------------------------------------------------------------

export const consistencyChecker = new ConsistencyChecker();

// Register all default checks
consistencyChecker.register(paymentStatusCheck);
consistencyChecker.register(orphanedItemsCheck);
consistencyChecker.register(negativeBankBalanceCheck);
consistencyChecker.register(negativeCashBoxBalanceCheck);
consistencyChecker.register(negativeCourierCashCheck);
consistencyChecker.register(receivableStatusCheck);
