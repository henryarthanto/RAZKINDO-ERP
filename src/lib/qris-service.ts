// =====================================================================
// QRIS PAYMENT SERVICE — Integration with Tripay Payment Gateway
//
// Handles QRIS payment creation, status checking, and webhook processing.
// Uses Tripay API for QRIS code generation.
//
// REQUIREMENTS:
//   - TRIPAY_API_KEY in .env (get from https://tripay.co.id)
//   - TRIPAY_PRIVATE_KEY in .env
//   - TRIPAY_MERCHANT_CODE in .env
//   - Set TRIPAY_MODE to 'production' or 'sandbox' (default: sandbox)
// =====================================================================

interface TripayTransaction {
  reference: string;
  merchant_ref: string;
  amount: number;
  fee_merchant: number;
  fee_customer: number;
  total_fee: number;
  status: string;
  payment_method: string;
  payment_name: string;
  pay_code: string;
  pay_url: string;
  checkout_url: string;
  expired_time: number;
  qr_string?: string;
  qr_url?: string;
  instructions: Array<{
    title: string;
    steps: string[];
  }>;
}

interface TripayCallbackPayload {
  event: string;
  reference: string;
  merchant_ref: string;
  payment_method: string;
  payment_name: string;
  fee_merchant: number;
  fee_customer: number;
  total_fee: number;
  amount: number;
  status: string;
  paid_at?: string;
  paid_amount?: number;
  signature: string;
}

function getTripayBaseUrl(): string {
  return process.env.TRIPAY_MODE === 'production'
    ? 'https://tripay.co.id/api'
    : 'https://tripay.co.id/api-sandbox';
}

function getTripayAuth(): string {
  const apiKey = process.env.TRIPAY_API_KEY;
  const privateKey = process.env.TRIPAY_PRIVATE_KEY;
  if (!apiKey || !privateKey) {
    throw new Error('TRIPAY_API_KEY and TRIPAY_PRIVATE_KEY are required');
  }
  return Buffer.from(`${apiKey}:${privateKey}`).toString('base64');
}

/**
 * Create a QRIS payment transaction via Tripay.
 */
export async function createQrisPayment(data: {
  invoiceNo: string;
  amount: number;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  callbackUrl: string;
  returnUrl: string;
  expiresInMinutes?: number;
}): Promise<TripayTransaction> {
  const merchantCode = process.env.TRIPAY_MERCHANT_CODE;
  if (!merchantCode) {
    throw new Error('TRIPAY_MERCHANT_CODE is required');
  }

  const methodCode = process.env.TRIPAY_MODE === 'production' ? 'QRIS' : 'QRIS';
  const expiresInMinutes = data.expiresInMinutes || 1440; // 24 hours default

  const response = await fetch(`${getTripayBaseUrl()}/transaction/create`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${getTripayAuth()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      method: methodCode,
      merchant_ref: data.invoiceNo,
      amount: data.amount,
      customer_name: data.customerName || '',
      customer_email: data.customerEmail || '',
      customer_phone: data.customerPhone || '',
      order_items: [
        {
          name: `Pembayaran ${data.invoiceNo}`,
          price: data.amount,
          quantity: 1,
        },
      ],
      callback_url: data.callbackUrl,
      return_url: data.returnUrl,
      expired_time: Math.floor(Date.now() / 1000) + (expiresInMinutes * 60),
    }),
  });

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.message || 'Gagal membuat pembayaran QRIS');
  }

  return result.data as TripayTransaction;
}

/**
 * Get QRIS payment status by reference.
 */
export async function getQrisStatus(reference: string): Promise<TripayTransaction> {
  const response = await fetch(
    `${getTripayBaseUrl()}/transaction?reference=${encodeURIComponent(reference)}`,
    {
      headers: {
        'Authorization': `Basic ${getTripayAuth()}`,
      },
    }
  );

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.message || 'Gagal cek status pembayaran');
  }

  return result.data as TripayTransaction;
}

/**
 * Verify Tripay callback signature.
 */
export async function verifyTripaySignature(payload: TripayCallbackPayload): Promise<boolean> {
  const privateKey = process.env.TRIPAY_PRIVATE_KEY;
  if (!privateKey) return false;

  const crypto = await import('crypto');
  const expectedSignature = crypto
    .createHmac('sha256', privateKey)
    .update(payload.merchant_ref + payload.status)
    .digest('hex');

  return expectedSignature === payload.signature;
}

/**
 * Map Tripay status to our internal status.
 */
export function mapTripayStatus(tripayStatus: string): 'paid' | 'pending' | 'expired' | 'failed' {
  switch (tripayStatus) {
    case 'PAID':
      return 'paid';
    case 'PENDING':
      return 'pending';
    case 'EXPIRED':
      return 'expired';
    case 'FAILED':
    case 'CANCELLED':
      return 'failed';
    default:
      return 'pending';
  }
}

/**
 * Check if QRIS/Tripay is configured.
 */
export function isQrisConfigured(): boolean {
  return !!(
    process.env.TRIPAY_API_KEY &&
    process.env.TRIPAY_PRIVATE_KEY &&
    process.env.TRIPAY_MERCHANT_CODE
  );
}

export type { TripayTransaction, TripayCallbackPayload };
