// =====================================================================
// MOOTA API v2 — Bank Mutation Aggregator Integration
//
// Moota REST API v2 wrapper for fetching bank accounts and mutations.
// Uses Personal Access Token for authentication.
//
// Endpoints:
//   GET /api/v2/bank              — List registered bank accounts
//   GET /api/v2/mutation          — List/search mutations (with bank_id param)
//   POST /api/v2/bank/{id}/refresh — Trigger mutation refresh
//
// Docs: https://docs.moota.co
// =====================================================================

const MOOTA_API_URL = process.env.MOOTA_API_URL || 'https://app.moota.co/api/v2';
const MOOTA_TOKEN = process.env.MOOTA_PERSONAL_TOKEN || '';

async function mootaFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${MOOTA_API_URL}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${MOOTA_TOKEN}`,
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      let errorMsg = `Moota API error ${response.status}`;
      try {
        const errJson = await response.json();
        errorMsg = errJson.message || errJson.error || errorMsg;
      } catch { /* use default */ }
      throw new Error(errorMsg);
    }

    return await response.json() as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────

export interface MootaBank {
  bank_id: string;
  bank_type: string;       // e.g., "bca", "bni", "mandiri", "bri"
  account_number: string;
  atas_nama: string;        // Account holder name (Indonesian)
  username: string;
  balance: string;         // String number, e.g., "31272559.15"
  date_from?: string;
  date_to?: string;
  meta?: Record<string, any>;
  corporate_id?: string | null;
}

export interface MootaMutation {
  mutation_id: string;
  bank_id: string;
  bank_type: string;
  account_number: string;
  date: string;             // "2026-04-29 00:00:00"
  note: string;
  description: string;      // Transaction description
  amount: string;           // String number, e.g., "130000.00" — positive always
  type: 'CR' | 'DB';       // CR = credit (masuk), DB = debit (keluar)
  balance: string;          // String number — balance after transaction
  contacts: any;
  items: any;
  marks: any;
  taggings: string[];
  token: string;
  created_at: string;
  updated_at: string;
}

export interface MootaPaginatedResponse<T> {
  data: T[];
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
  from: number;
  to: number;
}

// ─────────────────────────────────────────────────────────────────────
// API FUNCTIONS
// ─────────────────────────────────────────────────────────────────────

/**
 * Get all registered bank accounts from Moota
 */
export async function getMootaBanks(): Promise<MootaBank[]> {
  const response = await mootaFetch<MootaPaginatedResponse<MootaBank>>('/bank');
  if (response?.data && Array.isArray(response.data)) return response.data;
  return [];
}

/**
 * Get mutations for a specific bank account
 * Uses /api/v2/mutation endpoint with bank_id param
 */
export async function getMootaMutations(
  bankId: string,
  options: {
    page?: number;
    perPage?: number;
    start_date?: string;  // YYYY-MM-DD
    end_date?: string;    // YYYY-MM-DD
    type?: 'CR' | 'DB';  // Credit or Debit filter
  } = {}
): Promise<MootaPaginatedResponse<MootaMutation>> {
  const params = new URLSearchParams();
  params.set('bank_id', bankId);
  if (options.page) params.set('page', String(options.page));
  if (options.perPage) params.set('per_page', String(options.perPage));
  if (options.start_date) params.set('start_date', options.start_date);
  if (options.end_date) params.set('end_date', options.end_date);
  if (options.type) params.set('type', options.type);

  const query = params.toString();
  const response = await mootaFetch<MootaPaginatedResponse<MootaMutation>>(
    `/mutation?${query}`
  );

  return response || { data: [], current_page: 1, last_page: 1, per_page: 20, total: 0, from: 0, to: 0 };
}

/**
 * Refresh mutations from a bank (trigger Moota to scrape new data)
 */
export async function refreshMootaBank(bankId: string): Promise<{ success: boolean; message: string }> {
  try {
    await mootaFetch<any>(`/bank/${bankId}/refresh`, { method: 'POST' });
    return { success: true, message: 'Refresh berhasil, mutasi baru akan muncul dalam beberapa menit.' };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Gagal refresh mutasi bank.'
    };
  }
}

/**
 * Check if Moota is configured
 */
export function isMootaConfigured(): boolean {
  return !!MOOTA_TOKEN && MOOTA_TOKEN.length > 10;
}
