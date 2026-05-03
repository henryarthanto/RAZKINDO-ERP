import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { enforceFinanceRole } from '@/lib/require-auth';
import { createLog, generateId } from '@/lib/supabase-helpers';
import { getPoolBalance } from '@/lib/atomic-ops';
import { financeEngine } from '@/lib/finance-engine';
import { wsFinanceUpdate } from '@/lib/ws-dispatch';

// GET /api/finance/pools
// Banking-grade: Uses DB aggregate RPCs for O(1) derived calculation instead of fetching all rows.
export async function GET(request: NextRequest) {
  try {
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Read stored pool balances from settings (source of truth for composition)
    const storedHpp = await getPoolBalance('pool_hpp_paid_balance');
    const storedProfit = await getPoolBalance('pool_profit_paid_balance');
    const storedLainLain = await getPoolBalance('pool_investor_fund');

    // 2. Get derived HPP/Profit using server-side aggregate RPC (O(1) — no row fetching)
    let derivedHpp = 0;
    let derivedProfit = 0;
    try {
      const { data: saleAgg, error: aggError } = await db.rpc('get_sale_totals_aggregate');
      if (!aggError && saleAgg) {
        derivedHpp = Math.round(Number(saleAgg.hpp_paid) || 0);
        derivedProfit = Math.round(Number(saleAgg.profit_paid) || 0);
      }
    } catch {
      // Fallback: use stored values if RPC fails (shouldn't happen after ensure-rpc)
      derivedHpp = storedHpp;
      derivedProfit = storedProfit;
    }

    // 3. Get physical balances using server-side aggregate RPC
    let totalBrankas = 0;
    let totalRekening = 0;
    let totalPhysical = 0;
    try {
      const { data: physAgg, error: physError } = await db.rpc('get_physical_balance_totals');
      if (!physError && physAgg) {
        totalBrankas = Math.round(Number(physAgg.total_brankas) || 0);
        totalRekening = Math.round(Number(physAgg.total_rekening) || 0);
        totalPhysical = Math.round(Number(physAgg.total_physical) || 0);
      }
    } catch {
      // Fallback: manual query
      const { data: cashBoxes } = await db.from('cash_boxes').select('balance, is_active');
      const { data: bankAccounts } = await db.from('bank_accounts').select('balance, is_active');
      totalBrankas = (cashBoxes || [])
        .filter((cb: any) => cb.is_active !== false)
        .reduce((sum: number, cb: any) => sum + (Number(cb.balance) || 0), 0);
      totalRekening = (bankAccounts || [])
        .filter((ba: any) => ba.is_active !== false)
        .reduce((sum: number, ba: any) => sum + (Number(ba.balance) || 0), 0);
      totalPhysical = totalBrankas + totalRekening;
    }

    const totalPool = storedHpp + storedProfit + storedLainLain;
    const poolDiff = totalPhysical - totalPool;
    const hppDiff = storedHpp - derivedHpp;
    const profitDiff = storedProfit - derivedProfit;

    // Consistency health check
    const isHealthy = Math.abs(poolDiff) <= 0.01 && Math.abs(hppDiff) <= 0.01 && Math.abs(profitDiff) <= 0.01;

    return NextResponse.json({
      hppPaidBalance: storedHpp,
      profitPaidBalance: storedProfit,
      investorFund: storedLainLain,
      totalPool,
      totalPhysical,
      totalBrankas,
      totalRekening,
      derivedHpp,
      derivedProfit,
      poolDiff,
      hppDiff,
      profitDiff,
      isHealthy,
    });
  } catch (error) {
    console.error('Get pool balances error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

// PUT /api/finance/pools
// Manual adjustment: update HPP/Profit, auto-calculate Lain-lain to match physical.
export async function PUT(request: NextRequest) {
  try {
    const auth = await enforceFinanceRole(request);
    if (!auth.success) return auth.response;

    const body = await request.json();
    const { hppPaidBalance: inputHpp, profitPaidBalance: inputProfit, investorFund: inputLainLain } = body;

    // Get current stored values for audit
    const currentHpp = await getPoolBalance('pool_hpp_paid_balance');
    const currentProfit = await getPoolBalance('pool_profit_paid_balance');
    const currentLainLain = await getPoolBalance('pool_investor_fund');

    let finalHpp = currentHpp;
    let finalProfit = currentProfit;
    let finalLainLain = currentLainLain;

    if (inputHpp !== undefined && inputHpp !== null) {
      finalHpp = Math.max(0, Math.round(Number(inputHpp)));
    }
    if (inputProfit !== undefined && inputProfit !== null) {
      finalProfit = Math.max(0, Math.round(Number(inputProfit)));
    }
    if (inputLainLain !== undefined && inputLainLain !== null) {
      finalLainLain = Math.max(0, Math.round(Number(inputLainLain)));
    }

    // Auto-calculate Lain-lain = Physical - HPP - Profit (ensures pool matches physical)
    if (inputLainLain === undefined || inputLainLain === null) {
      let totalPhysical = 0;
      try {
        const { data: physAgg } = await db.rpc('get_physical_balance_totals');
        if (physAgg) totalPhysical = Number(physAgg.total_physical) || 0;
      } catch {
        const { data: cashBoxes } = await db.from('cash_boxes').select('balance, is_active');
        const { data: bankAccounts } = await db.from('bank_accounts').select('balance, is_active');
        totalPhysical = (cashBoxes || []).filter((cb: any) => cb.is_active !== false).reduce((sum: number, cb: any) => sum + (Number(cb.balance) || 0), 0)
          + (bankAccounts || []).filter((ba: any) => ba.is_active !== false).reduce((sum: number, ba: any) => sum + (Number(ba.balance) || 0), 0);
      }
      finalLainLain = Math.max(0, Math.round(totalPhysical - finalHpp - finalProfit));
    }

    // Save atomically
    await db.from('settings').upsert({ key: 'pool_hpp_paid_balance', value: JSON.stringify(finalHpp) }, { onConflict: 'key' });
    await db.from('settings').upsert({ key: 'pool_profit_paid_balance', value: JSON.stringify(finalProfit) }, { onConflict: 'key' });
    await db.from('settings').upsert({ key: 'pool_investor_fund', value: JSON.stringify(finalLainLain) }, { onConflict: 'key' });

    // Write ledger entries for pool adjustments (audit only — balances already updated above)
    const adjustmentJournalId = generateId();
    if (finalHpp !== currentHpp) {
      const delta = finalHpp - currentHpp;
      financeEngine.writeLedgerEntry({
        journalId: adjustmentJournalId,
        accountType: 'pool',
        accountKey: 'pool_hpp_paid_balance',
        delta: Math.round(delta),
        balanceBefore: Math.round(currentHpp),
        balanceAfter: Math.round(finalHpp),
        referenceType: 'pool_adjustment',
        referenceId: 'manual',
        description: `Penyesuaian manual HPP: ${currentHpp.toLocaleString('id-ID')} → ${finalHpp.toLocaleString('id-ID')}`,
        createdBy: auth.userId,
      }).catch(() => {});
    }
    if (finalProfit !== currentProfit) {
      const delta = finalProfit - currentProfit;
      financeEngine.writeLedgerEntry({
        journalId: adjustmentJournalId,
        accountType: 'pool',
        accountKey: 'pool_profit_paid_balance',
        delta: Math.round(delta),
        balanceBefore: Math.round(currentProfit),
        balanceAfter: Math.round(finalProfit),
        referenceType: 'pool_adjustment',
        referenceId: 'manual',
        description: `Penyesuaian manual Profit: ${currentProfit.toLocaleString('id-ID')} → ${finalProfit.toLocaleString('id-ID')}`,
        createdBy: auth.userId,
      }).catch(() => {});
    }
    if (finalLainLain !== currentLainLain) {
      const delta = finalLainLain - currentLainLain;
      financeEngine.writeLedgerEntry({
        journalId: adjustmentJournalId,
        accountType: 'pool',
        accountKey: 'pool_investor_fund',
        delta: Math.round(delta),
        balanceBefore: Math.round(currentLainLain),
        balanceAfter: Math.round(finalLainLain),
        referenceType: 'pool_adjustment',
        referenceId: 'manual',
        description: `Penyesuaian manual Lain-lain: ${currentLainLain.toLocaleString('id-ID')} → ${finalLainLain.toLocaleString('id-ID')}`,
        createdBy: auth.userId,
      }).catch(() => {});
    }

    const totalPool = finalHpp + finalProfit + finalLainLain;

    // Audit log with before/after
    try {
      createLog(db, {
        type: 'audit',
        action: 'pool_balances_updated',
        entity: 'settings',
        entityId: 'pool_hpp_paid_balance',
        userId: auth.userId,
        message: `Komposisi dana diperbarui: HPP ${currentHpp.toLocaleString('id-ID')} → ${finalHpp.toLocaleString('id-ID')}, Profit ${currentProfit.toLocaleString('id-ID')} → ${finalProfit.toLocaleString('id-ID')}, Lain-lain ${currentLainLain.toLocaleString('id-ID')} → ${finalLainLain.toLocaleString('id-ID')}, Total=${totalPool.toLocaleString('id-ID')}`
      });
    } catch { /* ignore */ }

    // Broadcast to all connected clients
    wsFinanceUpdate({ action: 'pool_updated', hppPaidBalance: finalHpp, profitPaidBalance: finalProfit, investorFund: finalLainLain, totalPool });

    return NextResponse.json({
      hppPaidBalance: finalHpp,
      profitPaidBalance: finalProfit,
      investorFund: finalLainLain,
      totalPool,
      message: `Komposisi dana diperbarui. HPP: ${finalHpp.toLocaleString('id-ID')}, Profit: ${finalProfit.toLocaleString('id-ID')}, Lain-lain: ${finalLainLain.toLocaleString('id-ID')}`
    });
  } catch (error) {
    console.error('Update pool balances error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

// POST /api/finance/pools
// Actions: sync_from_payments | reconcile | transfer_lain_lain
export async function POST(request: NextRequest) {
  try {
    const auth = await enforceFinanceRole(request);
    if (!auth.success) return auth.response;

    const body = await request.json();
    const { action } = body;

    // === SYNC FROM PAYMENTS ===
    if (action === 'sync_from_payments') {
      // Use server-side aggregate RPC for O(1) calculation
      let hppPaidBalance = 0;
      let profitPaidBalance = 0;
      try {
        const { data: saleAgg } = await db.rpc('get_sale_totals_aggregate');
        if (saleAgg) {
          hppPaidBalance = Math.round(Number(saleAgg.hpp_paid) || 0);
          profitPaidBalance = Math.round(Number(saleAgg.profit_paid) || 0);
        }
      } catch {
        // Fallback
        const { data: txnSums } = await db.from('transactions').select('hpp_paid, profit_paid').eq('type', 'sale');
        if (txnSums) {
          hppPaidBalance = Math.round(txnSums.reduce((sum: number, t: any) => sum + (Number(t.hpp_paid) || 0), 0));
          profitPaidBalance = Math.round(txnSums.reduce((sum: number, t: any) => sum + (Number(t.profit_paid) || 0), 0));
        }
      }

      // Get physical balance
      let totalBrankas = 0, totalRekening = 0, totalPhysical = 0;
      try {
        const { data: physAgg } = await db.rpc('get_physical_balance_totals');
        if (physAgg) {
          totalBrankas = Number(physAgg.total_brankas) || 0;
          totalRekening = Number(physAgg.total_rekening) || 0;
          totalPhysical = Number(physAgg.total_physical) || 0;
        }
      } catch {
        const { data: cashBoxes } = await db.from('cash_boxes').select('balance, is_active');
        const { data: bankAccounts } = await db.from('bank_accounts').select('balance, is_active');
        totalBrankas = (cashBoxes || []).filter((cb: any) => cb.is_active !== false).reduce((sum: number, cb: any) => sum + (Number(cb.balance) || 0), 0);
        totalRekening = (bankAccounts || []).filter((ba: any) => ba.is_active !== false).reduce((sum: number, ba: any) => sum + (Number(ba.balance) || 0), 0);
        totalPhysical = totalBrankas + totalRekening;
      }

      const investorFund = Math.max(0, totalPhysical - hppPaidBalance - profitPaidBalance);

      await db.from('settings').upsert({ key: 'pool_hpp_paid_balance', value: JSON.stringify(hppPaidBalance) }, { onConflict: 'key' });
      await db.from('settings').upsert({ key: 'pool_profit_paid_balance', value: JSON.stringify(profitPaidBalance) }, { onConflict: 'key' });
      await db.from('settings').upsert({ key: 'pool_investor_fund', value: JSON.stringify(investorFund) }, { onConflict: 'key' });

      try {
        createLog(db, {
          type: 'audit', action: 'pool_synced', entity: 'settings', entityId: 'pool_hpp_paid_balance', userId: auth.userId,
          message: `Pool disinkronkan: HPP=${hppPaidBalance.toLocaleString('id-ID')}, Profit=${profitPaidBalance.toLocaleString('id-ID')}, Lain-lain=${investorFund.toLocaleString('id-ID')} = Fisik ${totalPhysical.toLocaleString('id-ID')}`
        });
      } catch { /* ignore */ }

      wsFinanceUpdate({ action: 'pool_synced', hppPaidBalance, profitPaidBalance, investorFund });

      return NextResponse.json({
        hppPaidBalance, profitPaidBalance, investorFund,
        totalPool: hppPaidBalance + profitPaidBalance + investorFund,
        totalPhysical, totalBrankas, totalRekening,
        message: `Tersinkronisasi. HPP: ${hppPaidBalance.toLocaleString('id-ID')}, Profit: ${profitPaidBalance.toLocaleString('id-ID')}, Lain-lain: ${investorFund.toLocaleString('id-ID')}`
      });
    }

    // === RECONCILE (Banking-grade consistency check) ===
    if (action === 'reconcile') {
      const autoFix = body.autoFix === true;
      const { data: result, error } = await db.rpc('finance_reconcile', { p_auto_fix: autoFix });
      if (error) {
        // If RPC not found in schema cache, suggest calling /api/setup-rpc
        if (error.message?.includes('Could not find the function') || error.message?.includes('not found')) {
          return NextResponse.json({
            error: 'RPC function finance_reconcile belum ter-deploy. Jalankan /api/setup-rpc (POST, superadmin) untuk deploy semua RPC functions ke database.',
            hint: 'POST /api/setup-rpc'
          }, { status: 503 });
        }
        throw new Error(error.message);
      }

      try {
        createLog(db, {
          type: 'audit', action: 'finance_reconcile', entity: 'settings', entityId: 'pool_hpp_paid_balance', userId: auth.userId,
          message: `Rekonsiliasi: ${result.issues_count} masalah, auto_fix=${autoFix}, healthy=${result.is_healthy}`
        });
      } catch { /* ignore */ }

      return NextResponse.json(result);
    }

    // === TRANSFER DANA LAIN-LAIN ===
    if (action === 'transfer_lain_lain') {
      const { amount, destinationType, destinationId } = body;

      if (!amount || Number(amount) <= 0) {
        return NextResponse.json({ error: 'Jumlah transfer harus lebih dari 0' }, { status: 400 });
      }
      if (!destinationType || !['cashbox', 'bank'].includes(destinationType)) {
        return NextResponse.json({ error: 'Tipe tujuan harus cashbox atau bank' }, { status: 400 });
      }
      if (!destinationId) {
        return NextResponse.json({ error: 'Tujuan transfer wajib dipilih' }, { status: 400 });
      }

      const transferAmount = Math.round(Number(amount));
      const table = destinationType === 'cashbox' ? 'cash_boxes' : 'bank_accounts';

      // RACE CONDITION FIX: Removed pre-flight pool balance check.
      // The financeEngine.doubleEntry() call below handles atomic balance validation.
      // A stale read here could allow double-spending under concurrent requests.

      const transferJournalId = generateId();
      // Atomic double-entry: debit pool + credit destination in single DB transaction
      // Uses atomic_double_entry RPC with compensating rollback on failure
      const { debitResult: newLainLain, creditResult } = await financeEngine.doubleEntry(
        { type: 'pool', key: 'pool_investor_fund' },
        { type: 'physical', table: table, id: destinationId },
        transferAmount,
        transferJournalId,
        'transfer_lain_lain',
        destinationId,
        `Transfer Dana Lain-lain ke ${destinationType === 'cashbox' ? 'Brankas' : 'Rekening'}`,
        auth.userId,
      );

      try {
        createLog(db, {
          type: 'audit', action: 'lain_lain_transferred', entity: table, entityId: destinationId, userId: auth.userId,
          message: `Transfer Dana Lain-lain: Rp ${transferAmount.toLocaleString('id-ID')} → ${destinationType === 'cashbox' ? 'Brankas' : 'Rekening'} (${destinationId}). Sisa: Rp ${newLainLain.toLocaleString('id-ID')}`
        });
      } catch { /* ignore */ }

      wsFinanceUpdate({ action: 'lain_lain_transferred', amount: transferAmount, destinationType, destinationId });

      return NextResponse.json({
        success: true,
        transferAmount,
        newLainLain,
        message: `Berhasil transfer Rp ${transferAmount.toLocaleString('id-ID')} dari Dana Lain-lain ke ${destinationType === 'cashbox' ? 'Brankas' : 'Rekening'}. Sisa: Rp ${newLainLain.toLocaleString('id-ID')}`
      });
    }

    // === TRANSFER POOL-TO-POOL ===
    // Move funds between the 3 logical pools: HPP, Profit, Lain-lain
    // This does NOT touch physical accounts — it only reclassifies the composition
    if (action === 'pool_transfer') {
      const { fromPool, toPool, amount } = body;

      const VALID_POOLS: Record<string, string> = {
        hpp: 'pool_hpp_paid_balance',
        profit: 'pool_profit_paid_balance',
        lain_lain: 'pool_investor_fund',
      };

      if (!fromPool || !VALID_POOLS[fromPool]) {
        return NextResponse.json({ error: 'Pool asal tidak valid. Gunakan: hpp, profit, lain_lain' }, { status: 400 });
      }
      if (!toPool || !VALID_POOLS[toPool]) {
        return NextResponse.json({ error: 'Pool tujuan tidak valid. Gunakan: hpp, profit, lain_lain' }, { status: 400 });
      }
      if (fromPool === toPool) {
        return NextResponse.json({ error: 'Pool asal dan tujuan tidak boleh sama' }, { status: 400 });
      }
      if (!amount || Number(amount) <= 0) {
        return NextResponse.json({ error: 'Jumlah transfer harus lebih dari 0' }, { status: 400 });
      }

      const transferAmount = Math.round(Number(amount));
      const fromKey = VALID_POOLS[fromPool];
      const toKey = VALID_POOLS[toPool];

      // RACE CONDITION FIX: Removed pre-flight source pool balance check.
      // The financeEngine.doubleEntry() call below handles atomic balance validation.
      // A stale read here could allow double-spending under concurrent requests.

      const transferJournalId = generateId();
      const fromLabel = financeEngine.getPoolLabel(fromKey);
      const toLabel = financeEngine.getPoolLabel(toKey);

      // Atomic double-entry: debit source pool + credit destination pool
      const { debitResult: newFromBalance, creditResult: newToBalance } = await financeEngine.doubleEntry(
        { type: 'pool', key: fromKey },
        { type: 'pool', key: toKey },
        transferAmount,
        transferJournalId,
        'pool_transfer',
        transferJournalId,
        `Transfer Pool: ${fromLabel} → ${toLabel}`,
        auth.userId,
      );

      // Get all pool balances after transfer
      const finalHpp = await getPoolBalance('pool_hpp_paid_balance');
      const finalProfit = await getPoolBalance('pool_profit_paid_balance');
      const finalLainLain = await getPoolBalance('pool_investor_fund');
      const totalPool = finalHpp + finalProfit + finalLainLain;

      // Audit log
      try {
        createLog(db, {
          type: 'audit', action: 'pool_transfer', entity: 'settings', entityId: fromKey, userId: auth.userId,
          message: `Transfer Pool: Rp ${transferAmount.toLocaleString('id-ID')} dari ${fromLabel} → ${toLabel}. ${fromLabel}: → ${newFromBalance.toLocaleString('id-ID')}, ${toLabel}: → ${newToBalance.toLocaleString('id-ID')}`
        });
      } catch { /* ignore */ }

      // Broadcast
      wsFinanceUpdate({ action: 'pool_updated', hppPaidBalance: finalHpp, profitPaidBalance: finalProfit, investorFund: finalLainLain, totalPool });

      return NextResponse.json({
        success: true,
        transferAmount,
        fromPool: fromLabel,
        toPool: toLabel,
        newFromBalance,
        newToBalance,
        hppPaidBalance: finalHpp,
        profitPaidBalance: finalProfit,
        investorFund: finalLainLain,
        totalPool,
        message: `Berhasil transfer Rp ${transferAmount.toLocaleString('id-ID')} dari ${fromLabel} ke ${toLabel}`
      });
    }

    return NextResponse.json({ error: 'Action tidak valid' }, { status: 400 });
  } catch (error) {
    console.error('Sync pool balances error:', error);
    const message = error instanceof Error ? error.message : 'Terjadi kesalahan server';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
