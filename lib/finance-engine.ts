// =====================================================================
// FINANCE ENGINE — Banking-grade centralized ledger system
//
// IMPORTANT: Every balance change in the system MUST go through this engine.
// NEVER call atomicUpdatePoolBalance() or atomicUpdateBalance() directly
// in API routes — always use financeEngine methods so that ledger entries
// are written automatically for every mutation.
//
// The engine wraps each atomic operation with an immutable ledger entry,
// providing a complete audit trail of every financial balance change.
//
// ATOMICITY GUARANTEE: doubleEntry() uses the atomic_double_entry RPC
// which runs debit + credit + ledger writes in a single DB transaction
// with compensating rollback on failure.
// =====================================================================

import { db } from '@/lib/supabase';
import { atomicUpdatePoolBalance, atomicUpdateBalance, getPoolBalance } from '@/lib/atomic-ops';
import { generateId } from '@/lib/supabase-helpers';

export interface LedgerEntry {
  journalId: string;
  accountType: 'pool' | 'bank' | 'cashbox';
  accountKey: string;
  delta: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceType: string;
  referenceId?: string;
  description?: string;
  createdBy?: string;
}

export type AccountType = 'pool' | 'bank' | 'cashbox';
export type PhysicalTable = 'bank_accounts' | 'cash_boxes';

// Human-readable labels for pool keys
const POOL_LABELS: Record<string, string> = {
  pool_hpp_paid_balance: 'HPP Sudah Terbayar',
  pool_profit_paid_balance: 'Profit Sudah Terbayar',
  pool_investor_fund: 'Dana Lain-lain',
};

/**
 * Get a human-readable label for a pool key.
 */
function getPoolLabel(poolKey: string): string {
  return POOL_LABELS[poolKey] || poolKey;
}

/**
 * Get current balance for any account type.
 * For pool accounts: reads from settings table.
 * For physical accounts: reads from bank_accounts/cash_boxes table.
 */
async function getCurrentBalance(accountType: AccountType, accountKey: string): Promise<number> {
  if (accountType === 'pool') {
    return getPoolBalance(accountKey);
  }
  const table = accountType === 'bank' ? 'bank_accounts' : 'cash_boxes';
  const { data } = await db.from(table).select('balance').eq('id', accountKey).maybeSingle();
  return Number(data?.balance) || 0;
}

/**
 * Write a single ledger entry.
 * Errors are logged but never propagated — ledger is audit-only.
 * IMPORTANT: Callers should await this (not fire-and-forget) so errors
 * are properly logged and not silently lost.
 */
async function writeLedgerEntry(entry: LedgerEntry): Promise<void> {
  try {
    await db.from('finance_ledger').insert({
      id: generateId(),
      journal_id: entry.journalId,
      account_type: entry.accountType,
      account_key: entry.accountKey,
      delta: entry.delta,
      balance_before: entry.balanceBefore,
      balance_after: entry.balanceAfter,
      reference_type: entry.referenceType,
      reference_id: entry.referenceId || null,
      description: entry.description || null,
      created_by_id: entry.createdBy || null,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    // Ledger is audit-only — never fail the main operation, but ALWAYS log
    console.error('[FinanceEngine] Failed to write ledger entry:', {
      journalId: entry.journalId,
      accountType: entry.accountType,
      accountKey: entry.accountKey,
      delta: entry.delta,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Credit (add to) a pool balance atomically + write ledger entry.
 * Returns the new balance.
 */
async function creditPool(
  poolKey: string,
  amount: number,
  journalId: string,
  referenceType: string,
  referenceId: string,
  description: string,
  createdBy?: string,
  minBalance = 0,
): Promise<number> {
  const balanceBefore = await getPoolBalance(poolKey);
  const newBalance = await atomicUpdatePoolBalance(poolKey, amount, minBalance);

  // Await ledger write — errors are logged inside writeLedgerEntry
  await writeLedgerEntry({
    journalId,
    accountType: 'pool',
    accountKey: poolKey,
    delta: Math.round(amount),
    balanceBefore: Math.round(balanceBefore),
    balanceAfter: Math.round(newBalance),
    referenceType,
    referenceId,
    description,
    createdBy,
  });

  return newBalance;
}

/**
 * Debit (deduct from) a pool balance atomically + write ledger entry.
 * Throws if insufficient balance.
 */
async function debitPool(
  poolKey: string,
  amount: number,
  journalId: string,
  referenceType: string,
  referenceId: string,
  description: string,
  createdBy?: string,
  minBalance = 0,
): Promise<number> {
  const balanceBefore = await getPoolBalance(poolKey);
  const newBalance = await atomicUpdatePoolBalance(poolKey, -amount, minBalance);

  await writeLedgerEntry({
    journalId,
    accountType: 'pool',
    accountKey: poolKey,
    delta: -Math.round(amount),
    balanceBefore: Math.round(balanceBefore),
    balanceAfter: Math.round(newBalance),
    referenceType,
    referenceId,
    description,
    createdBy,
  });

  return newBalance;
}

/**
 * Credit (add to) a physical account (bank/cashbox) + write ledger entry.
 */
async function creditPhysical(
  table: PhysicalTable,
  accountId: string,
  amount: number,
  journalId: string,
  referenceType: string,
  referenceId: string,
  description: string,
  createdBy?: string,
  minBalance = 0,
): Promise<number> {
  const accountType: AccountType = table === 'bank_accounts' ? 'bank' : 'cashbox';
  const balanceBefore = await getCurrentBalance(accountType, accountId);
  const newBalance = await atomicUpdateBalance(table, accountId, amount, minBalance);

  await writeLedgerEntry({
    journalId,
    accountType,
    accountKey: accountId,
    delta: Math.round(amount),
    balanceBefore: Math.round(balanceBefore),
    balanceAfter: Math.round(newBalance),
    referenceType,
    referenceId,
    description,
    createdBy,
  });

  return newBalance;
}

/**
 * Debit (deduct from) a physical account + write ledger entry.
 */
async function debitPhysical(
  table: PhysicalTable,
  accountId: string,
  amount: number,
  journalId: string,
  referenceType: string,
  referenceId: string,
  description: string,
  createdBy?: string,
  minBalance = 0,
): Promise<number> {
  const accountType: AccountType = table === 'bank_accounts' ? 'bank' : 'cashbox';
  const balanceBefore = await getCurrentBalance(accountType, accountId);
  const newBalance = await atomicUpdateBalance(table, accountId, -amount, minBalance);

  await writeLedgerEntry({
    journalId,
    accountType,
    accountKey: accountId,
    delta: -Math.round(amount),
    balanceBefore: Math.round(balanceBefore),
    balanceAfter: Math.round(newBalance),
    referenceType,
    referenceId,
    description,
    createdBy,
  });

  return newBalance;
}

/**
 * Execute a double-entry operation: debit one account, credit another.
 * ATOMICITY: Uses the atomic_double_entry PostgreSQL RPC which runs
 * debit + credit + both ledger writes in a single DB transaction with
 * compensating rollback. If credit fails, the debit is automatically reversed.
 *
 * Falls back to sequential debit→credit with manual rollback if the RPC
 * is not yet deployed (e.g., during migration).
 *
 * Both operations share the same journalId for audit trail.
 */
async function doubleEntry(
  debit: { type: 'pool'; key: string } | { type: 'physical'; table: PhysicalTable; id: string },
  credit: { type: 'pool'; key: string } | { type: 'physical'; table: PhysicalTable; id: string },
  amount: number,
  journalId: string,
  referenceType: string,
  referenceId: string,
  description: string,
  createdBy?: string,
  minBalance = 0,
): Promise<{ debitResult: number; creditResult: number }> {
  // Build RPC parameters
  const debitType = debit.type === 'pool' ? 'pool' : 'physical';
  const debitTable = debit.type === 'physical' ? debit.table : null;
  const debitId = debit.type === 'pool' ? debit.key : debit.id;
  const debitDesc = debit.type === 'pool'
    ? `${description} (Debit: ${getPoolLabel(debit.key)})`
    : `${description} (Debit)`;

  const creditType = credit.type === 'pool' ? 'pool' : 'physical';
  const creditTable = credit.type === 'physical' ? credit.table : null;
  const creditId = credit.type === 'pool' ? credit.key : credit.id;
  const creditDesc = credit.type === 'pool'
    ? `${description} (Credit: ${getPoolLabel(credit.key)})`
    : `${description} (Credit)`;

  // Try atomic RPC first (single DB transaction with compensating rollback)
  try {
    const { data, error } = await db.rpc('atomic_double_entry', {
      p_debit_type: debitType,
      p_debit_table: debitTable,
      p_debit_id: debitId,
      p_credit_type: creditType,
      p_credit_table: creditTable,
      p_credit_id: creditId,
      p_amount: amount,
      p_journal_id: journalId,
      p_reference_type: referenceType,
      p_reference_id: referenceId,
      p_debit_description: debitDesc,
      p_credit_description: creditDesc,
      p_created_by_id: createdBy || null,
      p_min_balance: minBalance,
    });

    if (!error && data) {
      return {
        debitResult: Math.round(Number(data.debit_result) || 0),
        creditResult: Math.round(Number(data.credit_result) || 0),
      };
    }

    // RPC exists but failed — log and fall through to sequential fallback
    console.error('[FinanceEngine] atomic_double_entry RPC failed, using sequential fallback:', error?.message);
  } catch (err) {
    // RPC may not be deployed yet (e.g., first boot) — fall back to sequential
    console.warn('[FinanceEngine] atomic_double_entry RPC unavailable, using sequential fallback:', err instanceof Error ? err.message : String(err));
  }

  // Sequential fallback with compensating rollback
  let debitResult: number;
  try {
    if (debit.type === 'pool') {
      debitResult = await debitPool(debit.key, amount, journalId, referenceType, referenceId, debitDesc, createdBy, minBalance);
    } else {
      debitResult = await debitPhysical(debit.table, debit.id, amount, journalId, referenceType, referenceId, debitDesc, createdBy, minBalance);
    }
  } catch (debitErr) {
    // Debit itself failed — nothing to roll back, just rethrow
    throw debitErr;
  }

  let creditResult: number;
  try {
    if (credit.type === 'pool') {
      creditResult = await creditPool(credit.key, amount, journalId, referenceType, referenceId, creditDesc, createdBy, minBalance);
    } else {
      creditResult = await creditPhysical(credit.table, credit.id, amount, journalId, referenceType, referenceId, creditDesc, createdBy, minBalance);
    }
  } catch (creditErr) {
    // Credit failed — compensating rollback: reverse the debit
    console.error('[FinanceEngine] doubleEntry credit failed, performing compensating rollback');
    try {
      if (debit.type === 'pool') {
        await atomicUpdatePoolBalance(debit.key, amount, 0); // reverse the -amount debit
      } else {
        await atomicUpdateBalance(debit.table, debit.id, amount, 0);
      }
      console.error('[FinanceEngine] Compensating rollback succeeded');
    } catch (rollbackErr) {
      console.error('[FinanceEngine] CRITICAL: Compensating rollback failed — manual intervention required!', rollbackErr);
    }
    throw creditErr;
  }

  return { debitResult, creditResult };
}

/**
 * Transfer between two physical accounts (bank↔cashbox, bank↔bank, cashbox↔cashbox).
 * Debits source and credits destination with ledger entries.
 */
async function transferPhysical(
  fromTable: PhysicalTable,
  fromId: string,
  toTable: PhysicalTable,
  toId: string,
  amount: number,
  journalId: string,
  referenceType: string,
  referenceId: string,
  description: string,
  createdBy?: string,
): Promise<{ fromBalance: number; toBalance: number }> {
  let fromBalance: number;
  try {
    fromBalance = await debitPhysical(fromTable, fromId, amount, journalId, referenceType, referenceId, `${description} (Keluar)`, createdBy);
  } catch (debitErr) {
    // Debit itself failed — nothing to roll back, just rethrow
    throw debitErr;
  }

  let toBalance: number;
  try {
    toBalance = await creditPhysical(toTable, toId, amount, journalId, referenceType, referenceId, `${description} (Masuk)`, createdBy);
  } catch (creditErr) {
    // Credit failed — compensating rollback: reverse the debit
    console.error('[FinanceEngine] transferPhysical credit failed, performing compensating rollback');
    try {
      await atomicUpdateBalance(fromTable, fromId, amount, 0); // reverse the -amount debit
      console.error('[FinanceEngine] Compensating rollback succeeded');
    } catch (rollbackErr) {
      console.error('[FinanceEngine] CRITICAL: Compensating rollback failed — manual intervention required!', rollbackErr);
    }
    throw creditErr;
  }

  return { fromBalance, toBalance };
}

/**
 * Derive pool balances from ledger entries using DB-side aggregation (O(1)).
 * Falls back to client-side aggregation if the RPC is not yet deployed.
 */
async function getDerivedPoolBalances(): Promise<Record<string, number>> {
  try {
    const { data, error } = await db.rpc('get_derived_pool_balances');
    if (!error && data && typeof data === 'object') {
      const balances: Record<string, number> = {};
      for (const [key, value] of Object.entries(data)) {
        balances[key] = Math.round(Number(value) || 0);
      }
      return balances;
    }
    console.warn('[FinanceEngine] get_derived_pool_balances RPC failed, using client fallback:', error?.message);
  } catch (err) {
    console.warn('[FinanceEngine] get_derived_pool_balances RPC unavailable, using client fallback:', err instanceof Error ? err.message : String(err));
  }

  // Client-side fallback
  const { data: entries, error } = await db
    .from('finance_ledger')
    .select('account_key, delta')
    .eq('account_type', 'pool');

  if (error) {
    console.error('[FinanceEngine] Failed to derive pool balances from ledger:', error);
    return {};
  }

  const balances: Record<string, number> = {};
  for (const entry of (entries || [])) {
    const key = entry.account_key;
    balances[key] = (balances[key] || 0) + (Number(entry.delta) || 0);
  }

  for (const key of Object.keys(balances)) {
    balances[key] = Math.round(balances[key]);
  }

  return balances;
}

/**
 * Derive physical account balances from ledger entries using DB-side aggregation (O(1)).
 * Falls back to client-side aggregation if the RPC is not yet deployed.
 */
async function getDerivedPhysicalBalances(): Promise<{ bank: Record<string, number>; cashbox: Record<string, number> }> {
  try {
    const { data, error } = await db.rpc('get_derived_physical_balances');
    if (!error && data && typeof data === 'object') {
      const bankBalances: Record<string, number> = {};
      const cashboxBalances: Record<string, number> = {};
      const bankData = (data as any).bank;
      const cashboxData = (data as any).cashbox;
      if (bankData && typeof bankData === 'object') {
        for (const [key, value] of Object.entries(bankData)) {
          bankBalances[key] = Math.round(Number(value) || 0);
        }
      }
      if (cashboxData && typeof cashboxData === 'object') {
        for (const [key, value] of Object.entries(cashboxData)) {
          cashboxBalances[key] = Math.round(Number(value) || 0);
        }
      }
      return { bank: bankBalances, cashbox: cashboxBalances };
    }
    console.warn('[FinanceEngine] get_derived_physical_balances RPC failed, using client fallback:', error?.message);
  } catch (err) {
    console.warn('[FinanceEngine] get_derived_physical_balances RPC unavailable, using client fallback:', err instanceof Error ? err.message : String(err));
  }

  // Client-side fallback
  const { data: entries, error } = await db
    .from('finance_ledger')
    .select('account_type, account_key, delta')
    .neq('account_type', 'pool');

  if (error) {
    console.error('[FinanceEngine] Failed to derive physical balances from ledger:', error);
    return { bank: {}, cashbox: {} };
  }

  const bankBalances: Record<string, number> = {};
  const cashboxBalances: Record<string, number> = {};

  for (const entry of (entries || [])) {
    const key = entry.account_key;
    const delta = Number(entry.delta) || 0;
    if (entry.account_type === 'bank') {
      bankBalances[key] = (bankBalances[key] || 0) + delta;
    } else if (entry.account_type === 'cashbox') {
      cashboxBalances[key] = (cashboxBalances[key] || 0) + delta;
    }
  }

  for (const key of Object.keys(bankBalances)) bankBalances[key] = Math.round(bankBalances[key]);
  for (const key of Object.keys(cashboxBalances)) cashboxBalances[key] = Math.round(cashboxBalances[key]);

  return { bank: bankBalances, cashbox: cashboxBalances };
}

/**
 * Full reconciliation: Compare ledger-derived balances with actual stored balances.
 * Returns health status and any discrepancies found.
 */
async function reconcile(): Promise<{
  isHealthy: boolean;
  issues: Array<{ type: string; account: string; ledger: number; actual: number; diff: number }>;
  poolComparison: Record<string, { ledger: number; actual: number; diff: number }>;
}> {
  const issues: Array<{ type: string; account: string; ledger: number; actual: number; diff: number }> = [];
  const poolComparison: Record<string, { ledger: number; actual: number; diff: number }> = {};

  // Reconcile pool balances
  const derivedPools = await getDerivedPoolBalances();
  const poolKeys = ['pool_hpp_paid_balance', 'pool_profit_paid_balance', 'pool_investor_fund'];

  for (const key of poolKeys) {
    const ledgerBalance = derivedPools[key] || 0;
    const actualBalance = await getPoolBalance(key);
    const diff = actualBalance - ledgerBalance;
    poolComparison[key] = { ledger: ledgerBalance, actual: actualBalance, diff: Math.round(diff) };

    if (Math.abs(diff) > 0.01) {
      issues.push({
        type: 'pool_drift',
        account: getPoolLabel(key),
        ledger: ledgerBalance,
        actual: actualBalance,
        diff: Math.round(diff),
      });
    }
  }

  // Reconcile physical balances (fetch derived balances ONCE, then compare)
  const derivedPhysical = await getDerivedPhysicalBalances();

  const { data: bankAccounts } = await db.from('bank_accounts').select('id, name, balance').eq('is_active', true);
  for (const ba of (bankAccounts || [])) {
    const ledgerBal = derivedPhysical.bank[ba.id] || 0;
    const actualBal = Number(ba.balance) || 0;
    const diff = actualBal - ledgerBal;
    if (Math.abs(diff) > 0.01) {
      issues.push({ type: 'bank_drift', account: `${ba.name} (${ba.id.slice(0, 8)})`, ledger: ledgerBal, actual: actualBal, diff: Math.round(diff) });
    }
  }

  const { data: cashBoxes } = await db.from('cash_boxes').select('id, name, balance').eq('is_active', true);
  for (const cb of (cashBoxes || [])) {
    const ledgerBal = derivedPhysical.cashbox[cb.id] || 0;
    const actualBal = Number(cb.balance) || 0;
    const diff = actualBal - ledgerBal;
    if (Math.abs(diff) > 0.01) {
      issues.push({ type: 'cashbox_drift', account: `${cb.name} (${cb.id.slice(0, 8)})`, ledger: ledgerBal, actual: actualBal, diff: Math.round(diff) });
    }
  }

  return {
    isHealthy: issues.length === 0,
    issues,
    poolComparison,
  };
}

export const financeEngine = {
  creditPool,
  debitPool,
  creditPhysical,
  debitPhysical,
  doubleEntry,
  transferPhysical,
  getPoolLabel,
  writeLedgerEntry,
  getCurrentBalance,
  getDerivedPoolBalances,
  getDerivedPhysicalBalances,
  reconcile,
};
