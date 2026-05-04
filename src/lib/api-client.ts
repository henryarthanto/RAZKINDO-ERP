// =====================================================================
// API CLIENT - Centralized API Communication with Error Handling
// =====================================================================

export class ApiError extends Error {
  constructor(
    public status: number,
    public type: 'network' | 'auth' | 'forbidden' | 'validation' | 'server' | 'unknown',
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

// Helper for delay
const delay = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

// Determine error type based on status code
function getErrorType(status: number): ApiError['type'] {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 400 || status === 422) return 'validation';
  if (status >= 500) return 'server';
  if (status === 0) return 'network';
  return 'unknown';
}

// Get auth token from localStorage
function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem('razkindo-auth');
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.state?.token || null;
    }
  } catch {
    return null;
  }
  return null;
}

// Track if auth error was already handled to prevent race conditions
// from multiple concurrent 401 responses all trying to clear localStorage
let _authErrorHandled = false;
let _authErrorTimer: ReturnType<typeof setTimeout> | null = null;

function handleAuthError(status: number, message: string) {
  // Debounce: only handle the first auth error, ignore subsequent ones for 2 seconds
  if (_authErrorHandled) return;
  _authErrorHandled = true;
  
  // Reset after 2 seconds to allow future auth errors to be handled
  if (_authErrorTimer) clearTimeout(_authErrorTimer);
  _authErrorTimer = setTimeout(() => {
    _authErrorHandled = false;
  }, 2000);

  // Dispatch event for AppContent to handle logout
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('auth-error', { 
      detail: { status, message } 
    }));
  }
}

/**
 * apiFetch variant that does NOT trigger global logout on 401.
 * Use this for non-critical endpoints (settings, config, preferences)
 * where a transient 401 should show an error toast instead of logging out.
 */
export async function apiFetchNoAuth<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  // Set a flag so handleAuthError becomes a no-op
  _authErrorHandled = true;
  try {
    return await apiFetch<T>(url, options);
  } finally {
    // Reset after a short delay so real auth errors can still be caught
    setTimeout(() => { _authErrorHandled = false; }, 500);
  }
}

// Main fetch wrapper with retry and error handling
export async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
  retryCount = 0
): Promise<T> {
  const token = getAuthToken();
  
  const headers: Record<string, string> = {
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string> || {}),
  };
  
  // Add auth header if token exists
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    // Link caller's abort signal to our controller
    if (options.signal) {
      if (options.signal.aborted) {
        clearTimeout(timeoutId);
        throw new ApiError(0, 'network', 'Request was aborted');
      }
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    // Handle non-OK responses
    if (!response.ok) {
      let errorData: any = {};
      try {
        errorData = await response.json();
      } catch {
        // Response might not be JSON
      }
      
      const errorType = getErrorType(response.status);
      const message = errorData.error || errorData.message || `HTTP Error ${response.status}`;
      
      // Handle authentication errors
      // Bug #3 FIX: Don't trigger logout if no token was sent (pre-hydration race condition)
      // In this case, the request simply ran before the auth store rehydrated
      if (errorType === 'auth' && token) {
        handleAuthError(response.status, message);
      }
      
      throw new ApiError(response.status, errorType, message, errorData);
    }
    
    // Parse JSON response
    const data = await response.json();
    return data;
    
  } catch (error: any) {
    // Handle network errors with retry (only for idempotent methods)
    const method = (options.method || 'GET').toUpperCase();
    const isIdempotent = ['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (retryCount < MAX_RETRIES && isIdempotent && (
      error.name === 'AbortError' ||
      error.name === 'TypeError' || // Network error
      (error instanceof ApiError && error.status >= 500)
    )) {
      console.log(`Retrying request (${retryCount + 1}/${MAX_RETRIES})...`, url);
      await delay(RETRY_DELAYS[retryCount]);
      return apiFetch<T>(url, options, retryCount + 1);
    }
    
    // Handle abort/timeout
    if (error.name === 'AbortError') {
      throw new ApiError(0, 'network', 'Request timeout - periksa koneksi internet');
    }
    
    // Handle network errors
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new ApiError(0, 'network', 'Koneksi terputus - periksa koneksi internet');
    }
    
    // Re-throw ApiError
    if (error instanceof ApiError) {
      throw error;
    }
    
    // Unknown error
    throw new ApiError(0, 'unknown', error.message || 'Terjadi kesalahan tidak dikenal');
  }
}

// =====================================================================
// API ENDPOINTS - Organized by Module
// =====================================================================
export const api = {
  // ============ AUTH ============
  auth: {
    login: (email: string, password: string) =>
      apiFetch<{ user: any; token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),

    register: (data: any) =>
      apiFetch<{ user: any }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    logout: () =>
      apiFetch<{ success: boolean }>('/api/auth/logout', {
        method: 'POST',
      }),

    me: () =>
      apiFetch<{ user: any }>('/api/auth/me'),

    updateActivity: (page: string, action: string) =>
      apiFetch<{ success: boolean }>('/api/users/activity', {
        method: 'POST',
        body: JSON.stringify({ page, action }),
      }),

    checkSuperadmin: () =>
      apiFetch<{ exists: boolean }>('/api/auth/check-superadmin'),

    forgotPassword: (data: { phone: string }) =>
      apiFetch<{ success: boolean; message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    resetPassword: (data: { phone: string; code: string; newPassword: string }) =>
      apiFetch<{ success: boolean; message: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    changePassword: (data: { currentPassword: string; newPassword: string }) =>
      apiFetch<{ success: boolean; message: string }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  
  // ============ USERS ============
  users: {
    getAll: () =>
      apiFetch<{ users: any[] }>('/api/users'),
    
    getById: (id: string) =>
      apiFetch<{ user: any }>(`/api/users/${id}`),
    
    update: (id: string, data: any) =>
      apiFetch<{ user: any }>(`/api/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    
    approve: (id: string) =>
      apiFetch<{ user: any }>(`/api/users/${id}/approve`, {
        method: 'POST',
      }),
    
    delete: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/users/${id}`, {
        method: 'DELETE',
      }),
  },
  
  // ============ UNITS ============
  units: {
    getAll: () =>
      apiFetch<{ units: any[] }>('/api/units'),
    
    create: (data: any) =>
      apiFetch<{ unit: any }>('/api/units', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    
    update: (id: string, data: any) =>
      apiFetch<{ unit: any }>(`/api/units/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    
    delete: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/units/${id}`, {
        method: 'DELETE',
      }),
  },
  
  // ============ PRODUCTS ============
  products: {
    getAll: (unitId?: string) =>
      apiFetch<{ products: any[] }>(`/api/products${unitId ? `?unitId=${unitId}` : ''}`),
    
    getById: (id: string) =>
      apiFetch<{ product: any }>(`/api/products/${id}`),
    
    create: (data: any) =>
      apiFetch<{ product: any }>('/api/products', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    
    update: (id: string, data: any) =>
      apiFetch<{ product: any }>(`/api/products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    
    updateStock: (id: string, data: { quantity: number; type: 'in' | 'out'; unitId?: string; hpp?: number }) =>
      apiFetch<{ product: any }>(`/api/products/${id}/stock`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    
    delete: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/products/${id}`, {
        method: 'DELETE',
      }),
  },
  
  // ============ CUSTOMERS ============
  customers: {
    getAll: (unitId?: string) =>
      apiFetch<{ customers: any[] }>(`/api/customers${unitId ? `?unitId=${unitId}` : ''}`),

    create: (data: any) =>
      apiFetch<{ customer: any }>('/api/customers', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: any) =>
      apiFetch<{ customer: any }>(`/api/customers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/customers/${id}`, {
        method: 'DELETE',
      }),

    getLost: () =>
      apiFetch<{ customers: any[] }>('/api/customers/lost'),

    recycle: (data: any) =>
      apiFetch<{ success: boolean }>('/api/customers/recycle', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    followUp: (id: string, data: any) =>
      apiFetch<{ customer: any }>(`/api/customers/${id}/follow-up`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    markLost: (id: string, data: any) =>
      apiFetch<{ customer: any }>(`/api/customers/${id}/lost`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  
  // ============ TRANSACTIONS ============
  transactions: {
    getAll: (params?: { unitId?: string; type?: string; status?: string; startDate?: string; endDate?: string }) => {
      const query = new URLSearchParams();
      if (params?.unitId) query.set('unitId', params.unitId);
      if (params?.type) query.set('type', params.type);
      if (params?.status) query.set('status', params.status);
      if (params?.startDate) query.set('startDate', params.startDate);
      if (params?.endDate) query.set('endDate', params.endDate);
      return apiFetch<{ transactions: any[] }>(`/api/transactions?${query.toString()}`);
    },
    
    getById: (id: string) =>
      apiFetch<{ transaction: any }>(`/api/transactions/${id}`),
    
    create: (data: any) =>
      apiFetch<{ transaction: any }>('/api/transactions', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    
    update: (id: string, data: any) =>
      apiFetch<{ transaction: any }>(`/api/transactions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    
    approve: (id: string) =>
      apiFetch<{ transaction: any }>(`/api/transactions/${id}/approve`, {
        method: 'POST',
      }),
    
    cancel: (id: string) =>
      apiFetch<{ transaction: any }>(`/api/transactions/${id}/cancel`, {
        method: 'POST',
      }),
  },
  
  // ============ PAYMENTS ============
  payments: {
    getAll: (transactionId?: string) =>
      apiFetch<{ payments: any[] }>(`/api/payments${transactionId ? `?transactionId=${transactionId}` : ''}`),
    
    create: (data: any) =>
      apiFetch<{ payment: any }>('/api/payments', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  
  // ============ SALARIES ============
  salaries: {
    getAll: (params?: { userId?: string; status?: string }) => {
      const query = new URLSearchParams();
      if (params?.userId) query.set('userId', params.userId);
      if (params?.status) query.set('status', params.status);
      return apiFetch<{ salaries: any[] }>(`/api/salaries?${query.toString()}`);
    },

    create: (data: any) =>
      apiFetch<{ salary: any }>('/api/salaries', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    pay: (id: string, data: any) =>
      apiFetch<{ salary: any }>(`/api/salaries/${id}/pay`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/salaries/${id}`, {
        method: 'DELETE',
      }),
  },
  
  // ============ DASHBOARD ============
  dashboard: {
    get: (unitId?: string) =>
      apiFetch<{ dashboard: any }>(`/api/dashboard${unitId ? `?unitId=${unitId}` : ''}`),
  },
  
  // ============ EVENTS ============
  events: {
    get: (lastCreatedAt?: string) =>
      apiFetch<{ events: any[] }>(`/api/events${lastCreatedAt ? `?lastCreatedAt=${lastCreatedAt}` : ''}`),
    
    markRead: (ids: string[]) =>
      apiFetch<{ success: boolean }>('/api/events/read', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
  },
  
  // ============ REPORTS ============
  reports: {
    get: (params: { type: string; unitId?: string; startDate: string; endDate: string }) => {
      const query = new URLSearchParams(params as any);
      return apiFetch<{ report: any }>(`/api/reports?${query.toString()}`);
    },
  },
  
  // ============ LOGS ============
  logs: {
    get: (params?: { type?: string; limit?: number }) => {
      const query = new URLSearchParams(params as any);
      return apiFetch<{ logs: any[] }>(`/api/logs?${query.toString()}`);
    },
    
    create: (data: any) =>
      apiFetch<{ log: any }>('/api/logs', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  
  // ============ SETTINGS ============
  settings: {
    getAll: () =>
      apiFetch<{ settings: any }>('/api/settings'),
    
    update: (key: string, value: any) =>
      apiFetch<{ setting: any }>(`/api/settings/${key}`, {
        method: 'PATCH',
        body: JSON.stringify({ value }),
      }),
  },
  
  // ============ WHATSAPP ============
  whatsapp: {
    send: (token: string, target: string, message: string) =>
      apiFetch<{ success: boolean }>('/api/whatsapp/send', {
        method: 'POST',
        body: JSON.stringify({ token, target, message }),
      }),
    
    getGroups: (token: string) =>
      apiFetch<{ success: boolean; groups?: any[] }>('/api/whatsapp/groups', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    
    getConfig: () =>
      apiFetch<{ config: any }>('/api/whatsapp/config'),
    
    updateConfig: (data: any) =>
      apiFetch<{ config: any }>('/api/whatsapp/config', {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    
    testConnection: (token: string) =>
      apiFetch<{ success: boolean; devices?: any[]; error?: string }>('/api/whatsapp/test', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    
    getMessageTemplate: () =>
      apiFetch<{ template: string }>('/api/whatsapp/message-template'),
    
    updateMessageTemplate: (template: string) =>
      apiFetch<{ template: string }>('/api/whatsapp/message-template', {
        method: 'PATCH',
        body: JSON.stringify({ template }),
      }),
  },
  
  // ============ AI ============
  ai: {
    chat: (query: string, context?: any) =>
      apiFetch<{ analysis: any }>('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ query, context }),
      }),

    analyze: (query: string, context?: any) =>
      apiFetch<{ analysis: any }>('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ query, context }),
      }),
  },
  
  // ============ SUPPLIERS ============
  suppliers: {
    getAll: () =>
      apiFetch<{ suppliers: any[] }>('/api/suppliers'),

    create: (data: any) =>
      apiFetch<{ supplier: any }>('/api/suppliers', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: any) =>
      apiFetch<{ supplier: any }>(`/api/suppliers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/suppliers/${id}`, {
        method: 'DELETE',
      }),
  },

  // ============ FINANCE ============
  finance: {
    // Bank Accounts
    bankAccounts: {
      getAll: () =>
        apiFetch<{ bankAccounts: any[] }>('/api/finance/bank-accounts'),

      create: (data: any) =>
        apiFetch<{ bankAccount: any }>('/api/finance/bank-accounts', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      update: (id: string, data: any) =>
        apiFetch<{ bankAccount: any }>(`/api/finance/bank-accounts/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),

      delete: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/finance/bank-accounts/${id}`, {
          method: 'DELETE',
        }),
    },

    // Cash Boxes
    cashBoxes: {
      getAll: () =>
        apiFetch<{ cashBoxes: any[] }>('/api/finance/cash-boxes'),

      create: (data: any) =>
        apiFetch<{ cashBox: any }>('/api/finance/cash-boxes', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      update: (id: string, data: any) =>
        apiFetch<{ cashBox: any }>(`/api/finance/cash-boxes/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),

      delete: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/finance/cash-boxes/${id}`, {
          method: 'DELETE',
        }),
    },

    // Finance/Purchase Requests
    requests: {
      getAll: () =>
        apiFetch<{ requests: any[] }>('/api/finance/requests'),

      create: (data: any) =>
        apiFetch<{ request: any }>('/api/finance/requests', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      update: (id: string, data: any) =>
        apiFetch<{ request: any }>(`/api/finance/requests/${id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
    },

    // Fund Transfers
    transfers: {
      getAll: () =>
        apiFetch<{ transfers: any[] }>('/api/finance/transfers'),

      create: (data: any) =>
        apiFetch<{ transfer: any }>('/api/finance/transfers', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      update: (id: string, data: any) =>
        apiFetch<{ transfer: any }>(`/api/finance/transfers/${id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
    },

    // Company Debts
    debts: {
      getAll: () =>
        apiFetch<{ debts: any[] }>('/api/finance/debts'),

      create: (data: any) =>
        apiFetch<{ debt: any }>('/api/finance/debts', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      delete: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/finance/debts/${id}`, {
          method: 'DELETE',
        }),

      recordPayment: (id: string, data: any) =>
        apiFetch<{ payment: any }>(`/api/finance/debts/${id}/payment`, {
          method: 'POST',
          body: JSON.stringify(data),
        }),
    },

    // Receivables
    receivables: {
      getAll: () =>
        apiFetch<{ receivables: any[] }>('/api/finance/receivables'),

      create: (data: any) =>
        apiFetch<{ receivable: any }>('/api/finance/receivables', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      update: (id: string, data: any) =>
        apiFetch<{ receivable: any }>(`/api/finance/receivables/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),

      sync: () =>
        apiFetch<{ receivables: any[] }>('/api/finance/receivables/sync', {
          method: 'POST',
        }),

      followUp: (id: string, data: any) =>
        apiFetch<{ receivable: any }>(`/api/finance/receivables/${id}/follow-up`, {
          method: 'POST',
          body: JSON.stringify(data),
        }),
    },
  },

  // ============ COURIER ============
  courier: {
    getDashboard: (courierId: string) =>
      apiFetch<{ dashboard: any }>(`/api/courier/dashboard?courierId=${courierId}`),

    getCashSummary: (courierId: string) =>
      apiFetch<{ summary: any }>(`/api/courier/cash-summary?courierId=${courierId}`),

    handover: (data: any) =>
      apiFetch<{ success: boolean }>('/api/courier/handover', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    deliver: (transactionId: string, data: any) =>
      apiFetch<{ success: boolean; commission?: number }>(`/api/courier/deliver`, {
        method: 'PATCH',
        body: JSON.stringify({ transactionId, ...data }),
      }),
  },

  // ============ STORAGE ============
  storage: {
    get: () =>
      apiFetch<{ storage: any }>('/api/storage'),

    cleanup: () =>
      apiFetch<{ success: boolean }>('/api/storage', {
        method: 'POST',
        body: JSON.stringify({ action: 'cleanup' }),
      }),

    backup: () =>
      apiFetch<{ success: boolean }>('/api/storage', {
        method: 'POST',
        body: JSON.stringify({ action: 'backup' }),
      }),
  },

  // ============ SALES TARGETS ============
  salesTargets: {
    getAll: (params?: { userId?: string; year?: number; period?: string }) => {
      const query = new URLSearchParams();
      if (params?.userId) query.set('userId', params.userId);
      if (params?.year) query.set('year', String(params.year));
      if (params?.period) query.set('period', params.period);
      return apiFetch<{ targets: any[] }>(`/api/sales/targets?${query.toString()}`);
    },

    create: (data: { userId: string; period: string; year: number; month?: number | null; quarter?: number | null; targetAmount: number; notes?: string }) =>
      apiFetch<{ target: any }>('/api/sales/targets', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: { targetAmount?: number; status?: string; notes?: string }) =>
      apiFetch<{ target: any }>(`/api/sales/targets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/sales/targets/${id}`, {
        method: 'DELETE',
      }),
  },

  // ============ SALES TASKS (PENUGASAN) ============
  salesTasks: {
    getAll: (params?: { status?: string; priority?: string; type?: string; assignedToId?: string }) => {
      const query = new URLSearchParams();
      if (params?.status) query.set('status', params.status);
      if (params?.priority) query.set('priority', params.priority);
      if (params?.type) query.set('type', params.type);
      if (params?.assignedToId) query.set('assignedToId', params.assignedToId);
      return apiFetch<{ tasks: any[]; summary: any }>(`/api/sales-tasks?${query.toString()}`);
    },

    getById: (id: string) =>
      apiFetch<{ task: any }>(`/api/sales-tasks/${id}`),

    create: (data: { title: string; description?: string; type?: string; priority?: string; assignedToId: string; dueDate?: string }) =>
      apiFetch<{ task: any }>('/api/sales-tasks', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: any) =>
      apiFetch<{ task: any }>(`/api/sales-tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/sales-tasks/${id}`, {
        method: 'DELETE',
      }),

    submitReport: (id: string, data: { status: string; note: string; evidence?: string }) =>
      apiFetch<{ report: any }>(`/api/sales-tasks/${id}/report`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  // ============ CASHBACK (Customer PWA) ============
  cashback: {
    getConfig: () =>
      apiFetch<{ config: any; allConfigs: any[]; stats: any }>('/api/cashback/config'),

    updateConfig: (data: { type: string; value: number; maxCashback?: number; minOrder?: number; referralBonusType?: string; referralBonusValue?: number }) =>
      apiFetch<{ success: boolean; config: any }>('/api/cashback/config', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    getWithdrawals: (status?: string) =>
      apiFetch<{ withdrawals: any[]; stats: any }>(`/api/cashback/withdrawals${status ? `?status=${status}` : ''}`),

    processWithdrawal: (id: string, data: { status: string; rejectionReason?: string; notes?: string }) =>
      apiFetch<{ success: boolean; withdrawal: any }>(`/api/cashback/withdrawals/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    getReferrals: (status?: string) =>
      apiFetch<{ referrals: any[]; stats: any }>(`/api/referrals${status ? `?status=${status}` : ''}`),

    updateReferral: (id: string, data: { status: string; notes?: string; followUpDate?: string }) =>
      apiFetch<{ success: boolean; referral: any }>(`/api/referrals/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
  },

  // ============ MOOTA (Bank Mutations) ============
  moota: {
    getBanks: () =>
      apiFetch<{ banks: any[] }>('/api/finance/moota/banks'),

    getMutations: (bankId: string, params?: { page?: number; perPage?: number; startDate?: string; endDate?: string; type?: string }) => {
      const query = new URLSearchParams();
      if (params?.page) query.set('page', String(params.page));
      if (params?.perPage) query.set('perPage', String(params.perPage));
      if (params?.startDate) query.set('startDate', params.startDate);
      if (params?.endDate) query.set('endDate', params.endDate);
      if (params?.type) query.set('type', params.type);
      return apiFetch<{ data: any[]; current_page: number; last_page: number; total: number }>(
        `/api/finance/moota/mutations?bankId=${bankId}&${query.toString()}`
      );
    },

    refresh: (bankId: string) =>
      apiFetch<{ success: boolean; message: string }>('/api/finance/moota/refresh', {
        method: 'POST',
        body: JSON.stringify({ bankId }),
      }),

    match: (data: any) =>
      apiFetch<{ success: boolean; message: string }>('/api/finance/moota/match', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  // ============ SYSTEM ============
  system: {
    reset: (type: 'all' | 'transactions' | 'products' | 'users') =>
      apiFetch<{ success: boolean }>('/api/system/reset', {
        method: 'POST',
        body: JSON.stringify({ type }),
      }),

    getInfo: () =>
      apiFetch<{ info: any }>('/api/system/info'),

    restore: (data: FormData) =>
      apiFetch<{ success: boolean }>('/api/system/restore', {
        method: 'POST',
        body: data,
      }),
  },
};
