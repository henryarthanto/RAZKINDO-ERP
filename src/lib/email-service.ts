// =====================================================================
// EMAIL NOTIFICATION SERVICE — Resend integration
//
// Handles transactional email sending for key business events.
// Uses Resend API for reliable email delivery.
//
// REQUIREMENTS:
//   - RESEND_API_KEY in .env (get from https://resend.com)
//   - Verify sender domain in Resend dashboard
// =====================================================================

import { Resend } from 'resend';

let _resend: Resend | null = null;

function getResendClient(): Resend | null {
  if (_resend) return _resend;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[Email] RESEND_API_KEY not configured. Email notifications are disabled.');
    }
    return null;
  }

  _resend = new Resend(apiKey);
  return _resend;
}

export const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@razkindo.com';

// =====================================================================
// EMAIL TEMPLATES
// =====================================================================

export interface EmailTemplate {
  subject: string;
  html: string;
}

/**
 * Transaction approved notification
 */
export function transactionApprovedTemplate(data: {
  invoiceNo: string;
  customerName: string;
  total: number;
  type: string;
}): EmailTemplate {
  const typeLabel = data.type === 'sale' ? 'Penjualan' : 'Pembelian';
  return {
    subject: `✅ ${typeLabel} ${data.invoiceNo} Disetujui`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #16a34a;">Transaksi Disetujui</h2>
        <p>Transaksi berikut telah disetujui:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 600;">Invoice</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb;">${data.invoiceNo}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 600;">Pelanggan</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb;">${data.customerName || '-'}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 600;">Tipe</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb;">${typeLabel}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 600;">Total</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb; color: #16a34a; font-weight: 700;">Rp ${data.total.toLocaleString('id-ID')}</td>
          </tr>
        </table>
        <p style="color: #6b7280; font-size: 14px;">Email ini dikirim otomatis oleh sistem Razkindo ERP.</p>
      </div>
    `,
  };
}

/**
 * Payment received notification
 */
export function paymentReceivedTemplate(data: {
  invoiceNo: string;
  amount: number;
  method: string;
  remaining: number;
}): EmailTemplate {
  const isLunas = data.remaining <= 0;
  return {
    subject: isLunas
      ? `💰 Pembayaran Lunas — ${data.invoiceNo}`
      : `💸 Pembayaran Diterima — ${data.invoiceNo}`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
        <h2 style="color: ${isLunas ? '#16a34a' : '#2563eb'};">${isLunas ? 'Pembayaran Lunas!' : 'Pembayaran Diterima'}</h2>
        <p>Pembayaran untuk invoice berikut telah diterima:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 600;">Invoice</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb;">${data.invoiceNo}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 600;">Jumlah Bayar</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 700;">Rp ${data.amount.toLocaleString('id-ID')}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 600;">Metode</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb;">${data.method}</td>
          </tr>
          ${!isLunas ? `
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 600;">Sisa</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb; color: #dc2626;">Rp ${data.remaining.toLocaleString('id-ID')}</td>
          </tr>
          ` : ''}
        </table>
        <p style="color: #6b7280; font-size: 14px;">Email ini dikirim otomatis oleh sistem Razkindo ERP.</p>
      </div>
    `,
  };
}

/**
 * Low stock alert notification
 */
export function lowStockTemplate(data: {
  productName: string;
  currentStock: number;
  minStock: number;
}): EmailTemplate {
  return {
    subject: `⚠️ Stok Rendah: ${data.productName}`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #dc2626;">Peringatan Stok Rendah</h2>
        <p>Stok produk berikut telah mencapai batas minimum:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 600;">Produk</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb;">${data.productName}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 600;">Stok Saat Ini</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb; color: #dc2626; font-weight: 700;">${data.currentStock}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 600;">Stok Minimum</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb;">${data.minStock}</td>
          </tr>
        </table>
        <p style="color: #6b7280; font-size: 14px;">Segera lakukan restocking untuk menghindari kehabisan stok.</p>
      </div>
    `,
  };
}

/**
 * New order notification (for sales/admin)
 */
export function newOrderTemplate(data: {
  invoiceNo: string;
  customerName: string;
  total: number;
}): EmailTemplate {
  return {
    subject: `🛒 Pesanan Baru — ${data.invoiceNo}`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2563eb;">Pesanan Baru Diterima</h2>
        <p>Pesanan baru telah masuk dan menunggu persetujuan:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 600;">Invoice</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb;">${data.invoiceNo}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 600;">Pelanggan</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb;">${data.customerName || '-'}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 600;">Total</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 700;">Rp ${data.total.toLocaleString('id-ID')}</td>
          </tr>
        </table>
        <p style="color: #6b7280; font-size: 14px;">Email ini dikirim otomatis oleh sistem Razkindo ERP.</p>
      </div>
    `,
  };
}

// =====================================================================
// SEND FUNCTIONS
// =====================================================================

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}

/**
 * Send a single email.
 */
export async function sendEmail(options: SendEmailOptions): Promise<{ success: boolean; error?: string }> {
  const resend = getResendClient();
  if (!resend) {
    return { success: false, error: 'Email service not configured' };
  }

  try {
    const result = await resend.emails.send({
      from: EMAIL_FROM,
      to: Array.isArray(options.to) ? options.to : [options.to],
      subject: options.subject,
      html: options.html,
      replyTo: options.replyTo,
    });

    if (result.error) {
      console.error('[Email] Send failed:', result.error);
      return { success: false, error: result.error.message };
    }

    return { success: true };
  } catch (error: any) {
    console.error('[Email] Send error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if email service is configured and ready.
 */
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}
