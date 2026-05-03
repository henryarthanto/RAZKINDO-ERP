import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, createEvent, generateId } from '@/lib/supabase-helpers';
import { getWhatsAppConfig, sendMessage, disableWhatsAppOnInvalidToken } from '@/lib/whatsapp';
import { pwaCashbackLimiter } from '@/lib/rate-limiter';

// =====================================================================
// PWA Customer Cashback Withdrawal Request — Public (no auth)
// POST /api/pwa/[code]/cashback/withdraw — Request cashback withdrawal
// =====================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const data = await request.json();

    if (!code) {
      return NextResponse.json({ error: 'Kode pelanggan diperlukan' }, { status: 400 });
    }

    // FIX: Rate limiting per customer code
    const rateResult = pwaCashbackLimiter(code.trim().toUpperCase());
    if (!rateResult.allowed) {
      return NextResponse.json({ error: 'Terlalu banyak permintaan pencairan. Coba lagi nanti.' }, { status: 429 });
    }

    // Validate required fields
    if (typeof data.amount !== 'number' || !Number.isFinite(data.amount) || data.amount <= 0) {
      return NextResponse.json({ error: 'Jumlah pencairan harus lebih dari 0' }, { status: 400 });
    }
    if (!data.bankName || !data.accountNo || !data.accountHolder) {
      return NextResponse.json({ error: 'Data bank wajib diisi (nama bank, nomor rekening, nama pemilik)' }, { status: 400 });
    }
    if (data.amount < 10000) {
      return NextResponse.json({ error: 'Minimum pencairan Rp10.000' }, { status: 400 });
    }

    // Look up customer (only active)
    const { data: customer } = await db
      .from('customers')
      .select('id, name, phone, cashback_balance')
      .eq('code', code.trim().toUpperCase())
      .eq('status', 'active')
      .single();

    if (!customer) {
      return NextResponse.json({ error: 'Kode pelanggan tidak ditemukan' }, { status: 404 });
    }

    // Check for recent pending/approved withdrawals from same customer
    const { data: recentWithdrawals } = await db
      .from('cashback_withdrawal')
      .select('id')
      .eq('customer_id', customer.id)
      .in('status', ['pending', 'approved'])
      .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString()) // last 5 minutes
      .limit(1);

    if (recentWithdrawals && recentWithdrawals.length > 0) {
      return NextResponse.json({ error: 'Anda sudah memiliki pencairan yang sedang diproses. Harap tunggu.' }, { status: 429 });
    }

    const balance = customer.cashback_balance || 0;

    if (data.amount > balance) {
      return NextResponse.json({ error: `Saldo cashback tidak mencukupi. Saldo: Rp${balance.toLocaleString('id-ID')}` }, { status: 400 });
    }

    // Create withdrawal
    const withdrawalId = generateId();
    const balanceAfter = balance - data.amount;

    // Deduct from customer balance using atomic RPC (prevents race condition)
    let deducted = false;
    try {
      const { error: rpcError } = await db.rpc('atomic_deduct_cashback', {
        p_customer_id: customer.id,
        p_delta: data.amount,
      });
      if (!rpcError) {
        deducted = true;
      }
    } catch {
      // RPC may not exist — fall through to read-then-write
    }

    // Fallback: read-then-write with optimistic guard if RPC failed
    if (!deducted) {
      const { error: updateError } = await db
        .from('customers')
        .update({ cashback_balance: balanceAfter })
        .eq('id', customer.id)
        .gt('cashback_balance', data.amount - 1); // optimistic guard
      if (updateError) {
        return NextResponse.json({ error: 'Gagal mengurangi saldo cashback. Coba lagi.' }, { status: 409 });
      }
    }

    // Create withdrawal record
    const { data: withdrawal, error: wdError } = await db
      .from('cashback_withdrawal')
      .insert({
        id: withdrawalId,
        customer_id: customer.id,
        amount: data.amount,
        bank_name: data.bankName,
        account_no: data.accountNo,
        account_holder: data.accountHolder,
        status: 'pending',
        notes: data.notes || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (wdError) {
      // Rollback: restore customer balance using atomic add
      try {
        await db.rpc('atomic_add_cashback', {
          p_customer_id: customer.id,
          p_delta: data.amount,
        });
      } catch {
        // Fallback rollback
        await db
          .from('customers')
          .update({ cashback_balance: balance })
          .eq('id', customer.id);
      }
      throw wdError;
    }

    // Create cashback log (non-blocking — don't fail if table doesn't exist)
    db.from('cashback_log').insert({
      id: generateId(),
      customer_id: customer.id,
      withdrawal_id: withdrawalId,
      type: 'withdrawn',
      amount: data.amount,
      description: `Pencairan cashback - ${data.bankName} (${data.accountNo})`,
      created_at: new Date().toISOString(),
    }).then(() => {}).catch((logErr: any) => {
      console.warn('[PWA Withdrawal] cashback_log insert failed (non-blocking):', logErr?.message || logErr);
    });

    // Create event notification for super admin
    createEvent(db, 'cashback_withdrawal_requested', {
      withdrawalId,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      amount: data.amount,
      bankName: data.bankName,
      accountNo: data.accountNo,
      accountHolder: data.accountHolder,
    }).catch(() => {});

    // Send WhatsApp notification to sales/admin group
    try {
      const config = await getWhatsAppConfig();
      if (config.enabled && config.token && config.target_id) {
        const amountStr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(data.amount);
        const message = `💰 *PENCAIRAN CASHBACK BARU*\n\n` +
          `👤 Pelanggan: ${customer.name}\n` +
          `📱 Telp: ${customer.phone || '-'}\n` +
          `💵 Jumlah: ${amountStr}\n` +
          `🏦 Bank: ${data.bankName}\n` +
          `📋 No. Rekening: ${data.accountNo}\n` +
          `👤 Atas Nama: ${data.accountHolder}\n\n` +
          `Segera proses pencairan di ERP.`;

        const result = await sendMessage(config.token, config.target_id, message);
        if (!result.success && result.tokenInvalid) {
          await disableWhatsAppOnInvalidToken();
        }
      }
    } catch (waErr) {
      console.error('[PWA Withdrawal] WhatsApp notification error (non-blocking):', waErr);
    }

    return NextResponse.json({
      success: true,
      withdrawal: toCamelCase(withdrawal),
      newBalance: balanceAfter,
      message: 'Permintaan pencairan berhasil dikirim. Admin akan memproses dalam 1-3 hari kerja.',
    });
  } catch (error: any) {
    console.error('PWA cashback withdraw POST error:', error?.message || error);
    // Return more specific error so frontend can show useful message
    const msg = error?.message || 'Terjadi kesalahan server';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
