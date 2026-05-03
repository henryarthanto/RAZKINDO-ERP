import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase } from '@/lib/supabase-helpers';

// =====================================================================
// PWA Invoice PDF Download — Public (no auth required)
// GET /api/pwa/[code]/invoice/[invoiceNo]
// Customer can download their own invoice as PDF
// =====================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string; invoiceNo: string }> }
) {
  try {
    const { code, invoiceNo } = await params;

    if (!code || !invoiceNo) {
      return NextResponse.json({ error: 'Kode dan invoice diperlukan' }, { status: 400 });
    }

    // Look up customer by code
    // FIX: Also filter by status:active — inactive/suspended customers should not access invoices
    const { data: customer } = await db
      .from('customers')
      .select('id, name, phone, address, code')
      .eq('code', code.trim().toUpperCase())
      .eq('status', 'active')
      .single();

    if (!customer) {
      return NextResponse.json({ error: 'Kode pelanggan tidak ditemukan' }, { status: 404 });
    }

    // Fetch transaction with items, unit, and creator
    const { data: transaction } = await db
      .from('transactions')
      .select(`
        *,
        unit:units(id, name),
        created_by:users!created_by_id(id, name),
        items:transaction_items(*, product:products(unit, sub_unit)),
        payments:payments(*)
      `)
      .eq('invoice_no', invoiceNo)
      .eq('customer_id', customer.id)
      .single();

    if (!transaction) {
      return NextResponse.json({ error: 'Invoice tidak ditemukan' }, { status: 404 });
    }

    // Fetch payment proofs
    const { data: proofs } = await db
      .from('payment_proofs')
      .select('id, file_url, file_name, uploaded_at')
      .eq('transaction_id', transaction.id)
      .order('uploaded_at', { ascending: false });

    // Fetch settings for company info
    const { data: settingsData } = await db
      .from('settings')
      .select('key, value')
      .in('key', ['company_name', 'company_logo', 'company_address', 'company_phone']);

    const settings: Record<string, string> = {};
    for (const s of (settingsData || [])) {
      try {
        settings[s.key] = typeof s.value === 'string' ? s.value : JSON.stringify(s.value);
      } catch {
        settings[s.key] = String(s.value);
      }
    }

    const camel = toCamelCase(transaction);
    const customerCamel = toCamelCase(customer);

    // SECURITY: Strip sensitive HPP/profit fields before returning to customer
    delete camel.totalHpp;
    delete camel.hppPaid;
    delete camel.hppUnpaid;
    delete camel.totalProfit;
    delete camel.profitPaid;
    delete camel.profitUnpaid;

    return NextResponse.json({
      transaction: {
        ...camel,
        createdBy: camel.createdBy || null,
        unit: camel.unit || null,
        items: (camel.items || []).map((i: any) => ({
          ...i,
          product: i.product || null,
        })),
        payments: (camel.payments || []),
        customer: customerCamel,
        paymentProofs: (proofs || []).map(p => toCamelCase(p)),
      },
      settings,
    });
  } catch (error) {
    console.error('PWA invoice GET error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
