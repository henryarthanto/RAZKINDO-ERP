import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, createEvent, generateId, generateCustomerCode } from '@/lib/supabase-helpers';
import { getWhatsAppConfig, sendMessage, disableWhatsAppOnInvalidToken } from '@/lib/whatsapp';

// =====================================================================
// PWA Customer Referrals — Public (no auth, identified by code)
// GET /api/pwa/[code]/referrals — Returns customer's referrals
// POST /api/pwa/[code]/referrals — Creates new referral
//
// SIMPLE FLOW:
//   1. Customer inputs referral (nama usaha, PIC, HP)
//   2. New customer record created → assigned to same sales as referrer
//   3. Referral record created linking referrer ↔ new customer
// =====================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;

    if (!code) {
      return NextResponse.json({ error: 'Kode pelanggan diperlukan' }, { status: 400 });
    }

    const { data: customer } = await db
      .from('customers')
      .select('id')
      .eq('code', code.trim().toUpperCase())
      .eq('status', 'active')
      .single();

    if (!customer) {
      return NextResponse.json({ error: 'Kode pelanggan tidak ditemukan' }, { status: 404 });
    }

    const { data: referrals } = await db
      .from('customer_referral')
      .select(`
        *,
        referral_customer:customers!referral_customer_id(id, name, phone, code, status, assigned_to_id)
      `)
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false })
      .limit(50);

    // Count by status
    const stats = {
      total: (referrals || []).length,
      new: (referrals || []).filter((r: any) => r.status === 'new').length,
      contacted: (referrals || []).filter((r: any) => r.status === 'contacted').length,
      converted: (referrals || []).filter((r: any) => r.status === 'converted').length,
      lost: (referrals || []).filter((r: any) => r.status === 'lost').length,
    };

    // Fetch referral bonus config
    const { data: refConfig } = await db
      .from('cashback_config')
      .select('referral_bonus_type, referral_bonus_value')
      .eq('is_active', true)
      .maybeSingle();

    return NextResponse.json({
      referrals: (referrals || []).map(r => ({
        ...toCamelCase(r),
        referralCustomer: toCamelCase(r.referral_customer || null),
      })),
      stats,
      referralConfig: refConfig ? toCamelCase(refConfig) : null,
    });
  } catch (error) {
    console.error('PWA referrals GET error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

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

    // Validate input
    if (!data.businessName || !data.picName || !data.phone) {
      return NextResponse.json({ error: 'Nama usaha, nama PIC, dan nomor HP wajib diisi' }, { status: 400 });
    }

    const phone = data.phone.replace(/\D/g, '');
    if (phone.length < 8 || phone.length > 15) {
      return NextResponse.json({ error: 'Nomor HP tidak valid' }, { status: 400 });
    }

    // ── Step 1: Find the referring customer ──
    const { data: customer, error: custFetchError } = await db
      .from('customers')
      .select('id, name, phone, unit_id, assigned_to_id')
      .eq('code', code.trim().toUpperCase())
      .eq('status', 'active')
      .single();

    if (custFetchError || !customer) {
      console.error('[PWA Referral] Customer not found:', custFetchError?.message);
      return NextResponse.json({ error: 'Kode pelanggan tidak ditemukan' }, { status: 404 });
    }

    console.log('[PWA Referral] Referrer found:', { id: customer.id, name: customer.name, assignedToId: customer.assigned_to_id, unitId: customer.unit_id });

    // ── Step 2: Check duplicate referral from same customer ──
    const { data: existingReferral, error: dupCheckError } = await db
      .from('customer_referral')
      .select('id')
      .eq('customer_id', customer.id)
      .eq('phone', phone)
      .maybeSingle();

    if (dupCheckError) {
      console.warn('[PWA Referral] Duplicate check error (table may not exist):', dupCheckError.message);
    }

    if (existingReferral) {
      return NextResponse.json({ error: 'Referral dengan nomor telepon ini sudah pernah ditambahkan' }, { status: 400 });
    }

    // ── Step 3: Check if a customer with this phone already exists ──
    const { data: existingCustomer } = await db
      .from('customers')
      .select('id, name, status')
      .eq('phone', phone)
      .eq('unit_id', customer.unit_id)
      .maybeSingle();

    let referralCustomerId: string | null = null;

    if (existingCustomer) {
      // Customer already exists — just link to this referral
      referralCustomerId = existingCustomer.id;
      console.log('[PWA Referral] Existing customer found:', { id: existingCustomer.id, name: existingCustomer.name });
    } else {
      // ── Step 4: Create new customer — EXACT same pattern as /api/customers POST ──
      // MUST provide id explicitly because DB may not have default (Prisma @default(cuid()) only works at Prisma Client level)
      const now = new Date().toISOString();
      const insertData: Record<string, unknown> = {
        id: generateId(),
        code: generateCustomerCode(),
        name: data.businessName.trim(),
        phone,
        unit_id: customer.unit_id,
        assigned_to_id: customer.assigned_to_id || null,
        distance: 'near',
        total_orders: 0,
        total_spent: 0,
        cashback_balance: 0,
        status: 'active',
        cashback_type: 'percentage',
        cashback_value: 0,
        created_at: now,
        updated_at: now,
      };

      console.log('[PWA Referral] Creating customer with data:', JSON.stringify({ ...insertData, id: insertData.id?.toString().substring(0, 8) + '...' }));

      const { data: newCustomer, error: insertError } = await db
        .from('customers')
        .insert(insertData)
        .select('id')
        .single();

      if (insertError || !newCustomer) {
        console.error('[PWA Referral] Customer insert FAILED:', JSON.stringify({
          message: insertError?.message,
          code: insertError?.code,
          details: insertError?.details,
          hint: insertError?.hint,
        }));

        // Fallback: try without assigned_to_id (FK might be stale)
        if (insertData.assigned_to_id) {
          console.log('[PWA Referral] Retrying customer insert without assigned_to_id...');
          delete insertData.assigned_to_id;
          insertData.id = generateId(); // new id to avoid conflict

          const { data: retryCustomer, error: retryError } = await db
            .from('customers')
            .insert(insertData)
            .select('id')
            .single();

          if (retryError || !retryCustomer) {
            console.error('[PWA Referral] Customer insert retry FAILED:', JSON.stringify({
              message: retryError?.message,
              code: retryError?.code,
              details: retryError?.details,
              hint: retryError?.hint,
            }));
            return NextResponse.json({ error: 'Gagal membuat data pelanggan referral' }, { status: 500 });
          }

          referralCustomerId = retryCustomer.id;
          console.log('[PWA Referral] Customer created on retry:', referralCustomerId);
        } else {
          return NextResponse.json({ error: 'Gagal membuat data pelanggan referral' }, { status: 500 });
        }
      } else {
        referralCustomerId = newCustomer.id;
        console.log('[PWA Referral] Customer created:', referralCustomerId);
      }
    }

    // ── Step 5: Create referral record ──
    // MUST provide id explicitly — same reason as customer insert
    const referralInsertData: Record<string, unknown> = {
      id: generateId(),
      customer_id: customer.id,
      business_name: data.businessName.trim(),
      pic_name: data.picName.trim(),
      phone,
      status: 'new',
      notes: data.notes || null,
      referral_customer_id: referralCustomerId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: referral, error: refError } = await db
      .from('customer_referral')
      .insert(referralInsertData)
      .select()
      .single();

    if (refError || !referral) {
      console.error('[PWA Referral] Referral insert FAILED:', JSON.stringify({
        message: refError?.message,
        code: refError?.code,
        details: refError?.details,
        hint: refError?.hint,
      }));

      // Fallback: try without referral_customer_id (FK or table might be the issue)
      if (referralCustomerId) {
        console.log('[PWA Referral] Retrying referral insert without referral_customer_id...');
        delete referralInsertData.referral_customer_id;
        referralInsertData.id = generateId();

        const { data: retryReferral, error: retryRefError } = await db
          .from('customer_referral')
          .insert(referralInsertData)
          .select()
          .single();

        if (retryRefError || !retryReferral) {
          console.error('[PWA Referral] Referral insert retry FAILED:', JSON.stringify({
            message: retryRefError?.message,
            code: retryRefError?.code,
            details: retryRefError?.details,
            hint: retryRefError?.hint,
          }));
          return NextResponse.json({ error: 'Gagal mengirim referensi' }, { status: 500 });
        }

        console.log('[PWA Referral] Referral created on retry (no linked customer)');
        return NextResponse.json({
          success: true,
          referral: toCamelCase(retryReferral),
          message: 'Referensi berhasil dikirim!',
        });
      }

      return NextResponse.json({ error: 'Gagal mengirim referensi' }, { status: 500 });
    }

    console.log('[PWA Referral] Referral created successfully:', referral.id);

    // ── Step 6: Create event notification (fire-and-forget) ──
    createEvent(db, 'customer_referral_submitted', {
      referralId: referral.id,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      businessName: data.businessName,
      picName: data.picName,
      phone,
      referralCustomerId,
    }).catch(() => {});

    // ── Step 7: Send WhatsApp notification (fire-and-forget) ──
    try {
      const config = await getWhatsAppConfig();
      if (config.enabled && config.token && config.target_id) {
        const dateStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const message = `🤝 *REFERRAL BARU DARI PWA*\n\n` +
          `👤 Dari: ${customer.name}\n` +
          `📱 Telp: ${customer.phone || '-'}\n\n` +
          `📋 *Data Referral:*\n` +
          `🏢 Usaha: ${data.businessName}\n` +
          `👤 PIC: ${data.picName}\n` +
          `📱 HP: ${phone}\n\n` +
          `📅 ${dateStr}\n\n` +
          `Segera follow up di ERP.`;

        const result = await sendMessage(config.token, config.target_id, message);
        if (!result.success && result.tokenInvalid) {
          await disableWhatsAppOnInvalidToken();
        }
      }
    } catch (waErr) {
      console.error('[PWA Referral] WhatsApp notification error (non-blocking):', waErr);
    }

    return NextResponse.json({
      success: true,
      referral: toCamelCase(referral),
      message: 'Referensi berhasil dikirim! Pelanggan baru telah ditambahkan ke sistem.',
    });
  } catch (error) {
    console.error('PWA referrals POST error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
