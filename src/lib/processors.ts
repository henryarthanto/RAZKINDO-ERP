// =====================================================================
// BullMQ Job Processors
//
// Central registry for all background job processors.
// Processors are registered in instrumentation.ts at server startup.
// =====================================================================

import { Job } from 'bullmq';
import { logInfo, logError } from './logger';
import { generateId } from './supabase-helpers';

// ─────────────────────────────────────────────────────────────────────
// TYPE DEFINITIONS
// ─────────────────────────────────────────────────────────────────────

export type ProcessorName =
  | 'send-whatsapp'
  | 'generate-invoice'
  | 'sync-stock'
  | 'cleanup-expired'
  | 'send-daily-report'
  | 'process-cashback'
  | 'check-low-stock';

export interface JobPayloads {
  'send-whatsapp': {
    phone: string;
    message: string;
    userId?: string;
  };
  'generate-invoice': {
    transactionId: string;
    invoiceNo: string;
  };
  'sync-stock': {
    productId: string;
    unitId?: string;
  };
  'cleanup-expired': {
    type: 'password_resets';
  };
  'send-daily-report': {
    unitId?: string;
    date: string;
  };
  'process-cashback': {
    transactionId: string;
    customerId: string;
  };
  'check-low-stock': {
    unitId?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────
// PROCESSORS
// ─────────────────────────────────────────────────────────────────────

/**
 * Send WhatsApp message (processed in background)
 */
async function processSendWhatsApp(job: Job) {
  const { phone, message, userId } = job.data as JobPayloads['send-whatsapp'];
  logInfo('Processing WhatsApp job', { jobId: job.id, phone, userId });

  try {
    const { sendWhatsAppMessage } = await import('./whatsapp');
    const result = await sendWhatsAppMessage({ phone, message });
    logInfo('WhatsApp sent', { jobId: job.id, phone, result: !!result });
    return { success: true, phone };
  } catch (err) {
    logError('WhatsApp job failed', err, { jobId: job.id, phone });
    throw err;
  }
}

/**
 * Generate invoice PDF
 */
async function processGenerateInvoice(job: Job) {
  const { transactionId, invoiceNo } = job.data as JobPayloads['generate-invoice'];
  logInfo('Generating invoice', { jobId: job.id, transactionId, invoiceNo });

  try {
    const { db } = await import('./supabase');
    const { data: tx } = await db.from('transactions').select('*').eq('id', transactionId).single();
    if (!tx) throw new Error('Transaction not found');

    const { data: items } = await db.from('transaction_items').select('*').eq('transaction_id', transactionId);

    // Generate PDF
    const { generateInvoicePDF } = await import('./generate-invoice-pdf');
    const pdfBuffer = await generateInvoicePDF(tx);

    logInfo('Invoice generated', { jobId: job.id, invoiceNo, size: pdfBuffer.length });
    return { success: true, invoiceNo, size: pdfBuffer.length };
  } catch (err) {
    logError('Invoice generation failed', err, { jobId: job.id, invoiceNo });
    throw err;
  }
}

/**
 * Sync stock across units
 */
async function processSyncStock(job: Job) {
  const { productId, unitId } = job.data as JobPayloads['sync-stock'];
  logInfo('Syncing stock', { jobId: job.id, productId, unitId });

  try {
    const { db } = await import('./supabase');
    const { data: product } = await db.from('products').select('stock_type, global_stock').eq('id', productId).single();
    if (!product) throw new Error('Product not found');

    if (product.stock_type === 'centralized') {
      // Sync global stock to all unit stocks
      const { data: unitProducts } = await db.from('unit_products').select('id').eq('product_id', productId);
      if (unitProducts && unitProducts.length > 0) {
        await db.from('unit_products')
          .update({ stock: product.global_stock })
          .eq('product_id', productId);
        logInfo('Stock synced to all units', { jobId: job.id, productId, count: unitProducts.length });
      }
    }

    return { success: true, productId };
  } catch (err) {
    logError('Stock sync failed', err, { jobId: job.id, productId });
    throw err;
  }
}

/**
 * Cleanup expired data (password resets)
 */
async function processCleanupExpired(job: Job) {
  const { type } = job.data as JobPayloads['cleanup-expired'];
  logInfo('Running cleanup', { jobId: job.id, type });

  try {
    const { db } = await import('./supabase');

    if (type === 'password_resets') {
      const { data } = await db.from('password_resets')
        .delete()
        .lt('expires_at', new Date().toISOString())
        .select('id');
      logInfo('Cleaned expired password resets', { jobId: job.id, count: data?.length || 0 });
      return { cleaned: data?.length || 0 };
    }

    return { cleaned: 0, type };
  } catch (err) {
    logError('Cleanup job failed', err, { jobId: job.id, type });
    throw err;
  }
}

/**
 * Check for low stock products
 */
async function processCheckLowStock(job: Job) {
  const { unitId } = job.data as JobPayloads['check-low-stock'];
  logInfo('Checking low stock', { jobId: job.id, unitId });

  try {
    const { db } = await import('./supabase');
    let query = db.from('products')
      .select('id, name, global_stock, min_stock, unit')
      .eq('is_active', true)
      .eq('track_stock', true)
      .gt('min_stock', 0);

    const { data: products } = await query;
    if (!products) return { lowStock: [] };

    const lowStock = products
      .filter((p: any) => p.global_stock <= p.min_stock)
      .map((p: any) => ({
        productId: p.id,
        name: p.name,
        current: p.global_stock,
        minimum: p.min_stock,
        unit: p.unit,
      }));

    if (lowStock.length > 0) {
      logInfo('Low stock detected', { jobId: job.id, count: lowStock.length });
    }

    return { lowStock };
  } catch (err) {
    logError('Low stock check failed', err, { jobId: job.id });
    throw err;
  }
}

/**
 * Process cashback for a transaction
 */
async function processCashback(job: Job) {
  const { transactionId, customerId } = job.data as JobPayloads['process-cashback'];
  logInfo('Processing cashback', { jobId: job.id, transactionId, customerId });

  try {
    const { db } = await import('./supabase');

    // Get cashback config
    const { data: config } = await db.from('cashback_config').select('*').eq('is_active', true).single();
    if (!config) return { success: false, reason: 'no_config' };

    // Get transaction
    const { data: tx } = await db.from('transactions').select('total').eq('id', transactionId).single();
    if (!tx) return { success: false, reason: 'no_transaction' };

    // Check minimum order
    if (config.min_order > 0 && tx.total < config.min_order) {
      return { success: false, reason: 'below_min_order' };
    }

    // Calculate cashback
    let cashbackAmount = 0;
    if (config.type === 'percentage') {
      cashbackAmount = (tx.total * config.value) / 100;
    } else {
      cashbackAmount = config.value;
    }

    // Cap at max
    if (config.max_cashback > 0) {
      cashbackAmount = Math.min(cashbackAmount, config.max_cashback);
    }

    cashbackAmount = Math.round(cashbackAmount);

    if (cashbackAmount <= 0) return { success: false, reason: 'zero_cashback' };

    // Add to customer balance (atomic RPC — prevents race condition)
    try {
      await db.rpc('atomic_add_cashback', {
        p_customer_id: customerId,
        p_delta: cashbackAmount,
      });
    } catch {
      // Fallback: direct update if RPC not available yet
      const { data: customer } = await db.from('customers')
        .select('cashback_balance')
        .eq('id', customerId)
        .single();
      const newBalance = (customer?.cashback_balance || 0) + cashbackAmount;
      await db.from('customers').update({ cashback_balance: newBalance }).eq('id', customerId);
    }

    // Log cashback
    await db.from('cashback_log').insert({
      id: generateId(),
      customer_id: customerId,
      transaction_id: transactionId,
      type: 'earned',
      amount: cashbackAmount,
      description: `Cashback dari transaksi`,
      created_at: new Date().toISOString(),
    });

    logInfo('Cashback processed', { jobId: job.id, amount: cashbackAmount, customerId });
    return { success: true, amount: cashbackAmount };
  } catch (err) {
    logError('Cashback processing failed', err, { jobId: job.id });
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────
// REGISTRY
// ─────────────────────────────────────────────────────────────────────

/**
 * Send daily report (summary of yesterday's transactions)
 */
async function processSendDailyReport(job: Job) {
  const { unitId, date } = job.data as JobPayloads['send-daily-report'];
  logInfo('Processing daily report', { jobId: job.id, unitId, date });

  try {
    const { db } = await import('./supabase');

    const startDate = date;
    const endDate = date;

    let query = db
      .from('transactions')
      .select('id, total, total_hpp, total_profit, status, payment_method, created_at')
      .gte('created_at', startDate)
      .lte('created_at', endDate + 'T23:59:59');

    if (unitId) query = query.eq('unit_id', unitId);

    const { data: transactions } = await query;
    const txList = transactions || [];

    const completed = txList.filter((t: any) => t.status === 'approved');
    const totalRevenue = completed.reduce((s: number, t: any) => s + (t.total || 0), 0);
    const totalHpp = completed.reduce((s: number, t: any) => s + (t.total_hpp || 0), 0);
    const totalProfit = completed.reduce((s: number, t: any) => s + (t.total_profit || 0), 0);

    const report = {
      date,
      totalTransactions: txList.length,
      completedTransactions: completed.length,
      totalRevenue,
      totalHpp,
      totalProfit,
      profitMargin: totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0,
    };

    logInfo('Daily report generated', { jobId: job.id, ...report });

    return report;
  } catch (err) {
    logError('Daily report failed', err, { jobId: job.id, date });
    throw err;
  }
}

const processors: Record<ProcessorName, (job: Job) => Promise<any>> = {
  'send-whatsapp': processSendWhatsApp,
  'generate-invoice': processGenerateInvoice,
  'sync-stock': processSyncStock,
  'cleanup-expired': processCleanupExpired,
  'check-low-stock': processCheckLowStock,
  'process-cashback': processCashback,
  'send-daily-report': processSendDailyReport,
};

/**
 * Get a processor function by name
 */
export function getProcessor(name: ProcessorName) {
  return processors[name];
}

/**
 * Get all processor names
 */
export function getProcessorNames(): ProcessorName[] {
  return Object.keys(processors) as ProcessorName[];
}

/**
 * Register all processors with the job queue
 */
export async function registerAllProcessors(): Promise<void> {
  const { registerProcessor } = await import('./job-queue');

  for (const [name, processor] of Object.entries(processors)) {
    registerProcessor(name as ProcessorName, processor);
    logInfo('Job processor registered', { name });
  }
}

// ─────────────────────────────────────────────────────────────────────
// SCHEDULED JOBS
// ─────────────────────────────────────────────────────────────────────

/**
 * Schedule periodic cleanup jobs
 */
export function schedulePeriodicJobs(): void {
  // Cleanup expired password resets every hour
  setInterval(async () => {
    try {
      const { enqueueJob } = await import('./job-queue');
      await enqueueJob('cleanup-expired', { type: 'password_resets' });
    } catch {
      // Ignore scheduling errors
    }
  }, 60 * 60 * 1000); // 1 hour

  // Check low stock every 30 minutes
  setInterval(async () => {
    try {
      const { enqueueJob } = await import('./job-queue');
      await enqueueJob('check-low-stock', {});
    } catch {
      // Ignore scheduling errors
    }
  }, 30 * 60 * 1000); // 30 minutes

}
