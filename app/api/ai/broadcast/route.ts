import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { rowsToCamelCase } from '@/lib/supabase-helpers';
import {
  getWhatsAppConfig,
  sendMessage,
  getGroups,
  disableWhatsAppOnInvalidToken,
} from '@/lib/whatsapp';

// =====================================================================
// GET /api/ai/broadcast
// Returns list of customers, employees, and WhatsApp groups for preview
// =====================================================================
export async function GET(request: NextRequest) {
  try {
    // --- Auth check: super_admin only ---
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify super_admin role
    const { data: authUser } = await db
      .from('users')
      .select('id, role, is_active, status')
      .eq('id', authUserId)
      .single();

    if (!authUser || !authUser.is_active || authUser.status !== 'approved' || authUser.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden - Super admin only' }, { status: 403 });
    }

    // --- Fetch active customers ---
    const { data: customers } = await db
      .from('customers')
      .select('id, name, phone')
      .eq('status', 'active')
      .order('name');

    // --- Fetch active employees ---
    const { data: employees } = await db
      .from('users')
      .select('id, name, phone')
      .eq('is_active', true)
      .eq('status', 'approved')
      .order('name');

    // --- Fetch WhatsApp groups ---
    const whatsappConfig = await getWhatsAppConfig();
    let groups: any[] = [];
    if (whatsappConfig.token && whatsappConfig.enabled) {
      const groupsResult = await getGroups(whatsappConfig.token);
      if (groupsResult.success && groupsResult.groups) {
        groups = groupsResult.groups.map((g: any) => ({
          id: g.id || g.jid || g.name,
          name: g.name || g.subject || '',
          jid: g.id || g.jid || '',
        }));
      }
    }

    return NextResponse.json({
      customers: rowsToCamelCase(customers || []),
      employees: rowsToCamelCase(employees || []),
      groups,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Gagal mengambil data broadcast';
    console.error('Broadcast GET error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// =====================================================================
// POST /api/ai/broadcast
// Send WhatsApp message to selected targets
// Body: {
//   message: string,
//   targets: { type: 'customer' | 'employee' | 'group', ids: string[] },
//   targetAll?: { type: 'all_customers' | 'all_employees' }
// }
// =====================================================================
export async function POST(request: NextRequest) {
  try {
    // --- Auth check: super_admin only ---
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify super_admin role
    const { data: authUser } = await db
      .from('users')
      .select('id, role, is_active, status')
      .eq('id', authUserId)
      .single();

    if (!authUser || !authUser.is_active || authUser.status !== 'approved' || authUser.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden - Super admin only' }, { status: 403 });
    }

    // --- Parse body ---
    const body = await request.json();
    const { message, targets, targetAll } = body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'Pesan wajib diisi' }, { status: 400 });
    }

    // Validate at least one target
    if ((!targets || !targets.ids || targets.ids.length === 0) && !targetAll) {
      return NextResponse.json({ error: 'Pilih minimal satu target penerima' }, { status: 400 });
    }

    // --- Get WhatsApp config ---
    const whatsappConfig = await getWhatsAppConfig();
    if (!whatsappConfig.token || !whatsappConfig.enabled) {
      return NextResponse.json(
        { error: 'WhatsApp belum dikonfigurasi atau dinonaktifkan. Cek Settings → WhatsApp.' },
        { status: 400 }
      );
    }

    const token = whatsappConfig.token;
    const trimmedMessage = message.trim();

    // --- Build list of targets to send to ---
    interface SendTarget {
      label: string;
      phoneOrJid: string;
    }
    const sendList: SendTarget[] = [];

    // Handle "target all" — send to all customers or all employees
    if (targetAll) {
      if (targetAll.type === 'all_customers') {
        const { data: allCustomers } = await db
          .from('customers')
          .select('id, name, phone')
          .eq('status', 'active');
        for (const c of allCustomers || []) {
          if (c.phone) {
            sendList.push({ label: c.name || c.id, phoneOrJid: c.phone });
          }
        }
      } else if (targetAll.type === 'all_employees') {
        const { data: allEmployees } = await db
          .from('users')
          .select('id, name, phone')
          .eq('is_active', true)
          .eq('status', 'approved');
        for (const e of allEmployees || []) {
          if (e.phone) {
            sendList.push({ label: e.name || e.id, phoneOrJid: e.phone });
          }
        }
      }
    }

    // Handle individual targets by type
    if (targets && targets.ids && targets.ids.length > 0) {
      const { type, ids } = targets;

      if (type === 'customer') {
        const { data: customerRows } = await db
          .from('customers')
          .select('id, name, phone')
          .in('id', ids);
        for (const c of customerRows || []) {
          if (c.phone) {
            sendList.push({ label: c.name || c.id, phoneOrJid: c.phone });
          }
        }
      } else if (type === 'employee') {
        const { data: employeeRows } = await db
          .from('users')
          .select('id, name, phone')
          .in('id', ids);
        for (const e of employeeRows || []) {
          if (e.phone) {
            sendList.push({ label: e.name || e.id, phoneOrJid: e.phone });
          }
        }
      } else if (type === 'group') {
        // For groups, ids contain JIDs
        const groupsResult = await getGroups(token);
        if (groupsResult.success && groupsResult.groups) {
          for (const g of groupsResult.groups) {
            const gId = g.id || g.jid;
            const gName = g.name || g.subject || gId;
            if (ids.includes(gId) || ids.includes(gName)) {
              sendList.push({ label: gName, phoneOrJid: gId });
            }
          }
        }
      }
    }

    if (sendList.length === 0) {
      return NextResponse.json(
        { error: 'Tidak ada target dengan nomor telepon yang valid' },
        { status: 400 }
      );
    }

    // --- Send messages ---
    let sentCount = 0;
    let failedCount = 0;
    const results: Array<{ target: string; success: boolean; error?: string }> = [];
    let tokenInvalid = false;

    for (const target of sendList) {
      const result = await sendMessage(token, target.phoneOrJid, trimmedMessage);
      if (result.success) {
        sentCount++;
        results.push({ target: target.label, success: true });
      } else {
        failedCount++;
        results.push({
          target: target.label,
          success: false,
          error: result.error || 'Gagal mengirim',
        });
        if (result.tokenInvalid) {
          tokenInvalid = true;
          break; // Stop sending if token is invalid
        }
      }
    }

    // If token was detected invalid, disable WhatsApp config
    if (tokenInvalid) {
      await disableWhatsAppOnInvalidToken();
    }

    return NextResponse.json({
      success: sentCount > 0,
      sent: sentCount,
      failed: failedCount,
      tokenInvalid,
      results,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Gagal mengirim broadcast';
    console.error('Broadcast POST error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
