import { db } from '@/lib/supabase';

// In-memory cache for WhatsApp config (TTL = 5 minutes)
let _cachedWhatsAppConfig: Awaited<ReturnType<typeof _fetchWhatsAppConfigFromDB>> | null = null;
let _cachedWhatsAppConfigExpiry = 0;
const WA_CONFIG_TTL = 5 * 60_000; // 5 minutes

// WhatsApp config interface stored in settings
export interface WhatsAppConfig {
  token: string;
  enabled: boolean;
  target_type: 'group' | 'phone';
  target_id: string;
  message_template?: string;
}

// Message template variables
export interface MessageTemplateVariables {
  sales_name: string;
  customer_name: string;
  unit_name: string;
  items: string;
  total: string;
  paid: string;
  remaining: string;
  payment_method: string;
  invoice_no: string;
  date: string;
  due_date: string;
  customer_phone: string;
  delivery_address: string;
}

// Timeout for all external Fonnte API calls (15 seconds)
const FONTE_TIMEOUT_MS = 15000;

/**
 * Safely parse JSON with error logging
 */
function safeJsonParse(text: string, context: string): any {
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error(`[WhatsApp] JSON parse error in ${context}:`, error);
    return null;
  }
}

/**
 * Check if response content-type is JSON before parsing
 */
function isJsonResponse(response: Response): boolean {
  return response.headers.get('content-type')?.includes('application/json') === true;
}

/**
 * Fetch WhatsApp config from database (uncached — used internally)
 */
async function _fetchWhatsAppConfigFromDB(): Promise<{ token: string; enabled: boolean; target_type?: string; target_id?: string; message_template?: string }> {
  const { data: settings } = await db
    .from('settings')
    .select('key, value')
    .in('key', ['whatsapp_config', 'whatsapp_message_template']);

  if (!settings || settings.length === 0) {
    return { token: '', enabled: false };
  }

  let token = '';
  let enabled = false;
  let targetType = 'group';
  let targetId = '';
  let messageTemplate = '';

  for (const row of settings) {
    if (row.key === 'whatsapp_config') {
      const config = safeJsonParse(row.value, 'getWhatsAppConfig');
      if (config) {
        token = config.token || '';
        enabled = config.enabled || false;
        targetType = config.target_type || 'group';
        targetId = config.target_id || '';
        messageTemplate = config.message_template || '';
      }
    }
    if (row.key === 'whatsapp_message_template') {
      messageTemplate = row.value || '';
    }
  }

  return {
    token,
    enabled,
    target_type: targetType,
    target_id: targetId,
    message_template: messageTemplate
  };
}

/**
 * Invalidate the WhatsApp config cache.
 * Call this after updating the config so the next read fetches fresh data.
 */
export function invalidateWhatsAppCache() {
  _cachedWhatsAppConfig = null;
  _cachedWhatsAppConfigExpiry = 0;
}

/**
 * Get full WhatsApp config — cached for 5 minutes.
 * Invalidates cache when disableWhatsAppOnInvalidToken() is called.
 */
export async function getWhatsAppConfig(): Promise<{ token: string; enabled: boolean; target_type?: string; target_id?: string; message_template?: string }> {
  if (_cachedWhatsAppConfig && Date.now() < _cachedWhatsAppConfigExpiry) {
    return _cachedWhatsAppConfig;
  }

  try {
    const config = await _fetchWhatsAppConfigFromDB();
    _cachedWhatsAppConfig = config;
    _cachedWhatsAppConfigExpiry = Date.now() + WA_CONFIG_TTL;
    return config;
  } catch (error) {
    console.error('WhatsApp config error:', error);
    return { token: '', enabled: false };
  }
}

/**
 * Test Fonnte API connection
 *
 * Uses two strategies:
 * 1. POST /device — returns device info (works with device token)
 * 2. POST /get-groups — returns WhatsApp groups (works with device token)
 *
 * Fonnte auth: Authorization: <token> (NO Bearer prefix)
 */
export async function testConnection(token: string): Promise<{ success: boolean; devices?: any[]; error?: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FONTE_TIMEOUT_MS);

    // Strategy 1: Try /device endpoint (device profile)
    const response = await fetch('https://api.fonnte.com/device', {
      method: 'POST',
      headers: {
        'Authorization': token
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!isJsonResponse(response)) {
      return {
        success: false,
        error: 'Respons server Fonnte bukan JSON. Coba lagi nanti.'
      };
    }

    const data = await response.json();

    // Fonnte returns { reason: "unknown user" } for bad tokens
    if (!response.ok || data.status === false) {
      const reason = data.reason || data.message || '';
      // If Fonnte explicitly says the user is unknown, the token is invalid
      if (reason.toLowerCase().includes('unknown') || response.status === 401 || response.status === 403) {
        return {
          success: false,
          error: reason || 'Token tidak valid. Pastikan token dari fonnte.com → Device → Copy API Key.'
        };
      }
      // For other errors (e.g., no device connected), still report but suggest checking
      return {
        success: false,
        error: reason || `Token ditolak (HTTP ${response.status}). Pastikan token benar dan device sudah terhubung.`
      };
    }

    // Fonnte returns device info — consider it a success
    const deviceName = data.data?.name || data.data?.device || data.name || 'Perangkat';
    const deviceStatus = data.data?.status || data.status;
    const isConnected = data.data?.connected !== false && deviceStatus !== 'disconnected';

    return {
      success: true,
      devices: [{
        name: deviceName,
        status: isConnected ? 'connected' : 'disconnected',
        raw: data.data || data
      }]
    };
  } catch (error: any) {
    console.error('WhatsApp test connection error:', error);
    if (error.name === 'AbortError') {
      return {
        success: false,
        error: 'Timeout: server Fonnte tidak merespons dalam 15 detik. Coba lagi nanti.'
      };
    }
    return {
      success: false,
      error: 'Gagal terhubung ke server Fonnte. Periksa koneksi internet Anda.'
    };
  }
}

/**
 * Get WhatsApp groups - POST https://api.fonnte.com/get-groups
 * Correct endpoint: /get-groups (NOT /get-whatsapp-group)
 * Correct body: no body needed
 */
export async function getGroups(token: string): Promise<{ success: boolean; groups?: any[]; error?: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FONTE_TIMEOUT_MS);

    const response = await fetch('https://api.fonnte.com/get-groups', {
      method: 'POST',
      headers: {
        'Authorization': token
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!isJsonResponse(response)) {
      return {
        success: false,
        error: 'Respons server Fonnte bukan JSON. Coba lagi nanti.'
      };
    }

    const data = await response.json();

    // Fonnte returns { status: false, reason: "..." } for bad tokens
    if (!response.ok || data.status === false) {
      return {
        success: false,
        error: data.reason || data.message || `Token tidak valid atau gagal mengambil grup`
      };
    }

    // Fonnte returns groups in data.groups or data.data array
    const groups = data.data?.groups || data.groups || (Array.isArray(data.data) ? data.data : []);

    return {
      success: true,
      groups: Array.isArray(groups) ? groups : []
    };
  } catch (error: any) {
    console.error('WhatsApp get groups error:', error);
    if (error.name === 'AbortError') {
      return {
        success: false,
        error: 'Timeout: server Fonnte tidak merespons dalam 15 detik. Coba lagi nanti.'
      };
    }
    return {
      success: false,
      error: 'Gagal mengambil daftar grup. Periksa koneksi internet Anda.'
    };
  }
}

/**
 * Send WhatsApp message - POST https://api.fonnte.com/send
 * target can be phone number (628xxx) or group JID (xxxxx@g.us)
 * Body format: FormData (multipart/form-data) — matches Fonnte PHP example
 */
export async function sendMessage(token: string, target: string, message: string): Promise<{ success: boolean; error?: string; tokenInvalid?: boolean }> {
  try {
    const params = new FormData();
    params.append('target', target);
    params.append('message', message);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FONTE_TIMEOUT_MS);

    const response = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: {
        'Authorization': token
      },
      body: params,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!isJsonResponse(response)) {
      return {
        success: false,
        error: 'Respons server Fonnte bukan JSON. Coba lagi nanti.'
      };
    }

    const data = await response.json();

    if (!response.ok) {
      const reason = data.reason || data.message || '';
      const isTokenInvalid = response.status === 401 || response.status === 403 ||
        reason.toLowerCase().includes('unknown') || reason.toLowerCase().includes('unauthorized');
      return {
        success: false,
        tokenInvalid: isTokenInvalid,
        error: isTokenInvalid
          ? 'Token WhatsApp tidak valid. Silakan perbarui token di Settings → WhatsApp.'
          : reason || `Gagal mengirim pesan (HTTP ${response.status})`
      };
    }

    // Fonnte returns { status: true/false, reason: string }
    if (data.status === false) {
      const reason = data.reason || '';
      const isTokenInvalid = reason.toLowerCase().includes('unknown') || reason.toLowerCase().includes('unauthorized');
      return {
        success: false,
        tokenInvalid: isTokenInvalid,
        error: isTokenInvalid
          ? 'Token WhatsApp tidak valid. Silakan perbarui token di Settings → WhatsApp.'
          : reason || 'Gagal mengirim pesan WhatsApp'
      };
    }

    return {
      success: true
    };
  } catch (error: any) {
    console.error('WhatsApp send message error:', error);
    if (error.name === 'AbortError') {
      return {
        success: false,
        error: 'Timeout: gagal mengirim pesan dalam 15 detik. Periksa koneksi internet.'
      };
    }
    return {
      success: false,
      error: 'Gagal mengirim pesan. Periksa koneksi internet Anda.'
    };
  }
}

/**
 * Auto-disable WhatsApp config in database when token is detected invalid.
 * Prevents repeated failed API calls.
 */
export async function disableWhatsAppOnInvalidToken(): Promise<void> {
  // Invalidate cache so next getWhatsAppConfig() re-reads from DB
  _cachedWhatsAppConfig = null;
  _cachedWhatsAppConfigExpiry = 0;

  try {
    const { data: setting } = await db
      .from('settings')
      .select('*')
      .eq('key', 'whatsapp_config')
      .maybeSingle();
    if (setting) {
      const config = safeJsonParse(setting.value, 'disableWhatsAppOnInvalidToken');
      if (!config) {
        console.error('[WhatsApp] Cannot auto-disable: config JSON is corrupt');
        return;
      }
      if (config.enabled !== false) {
        config.enabled = false;
        config._tokenInvalid = true;
        config._tokenInvalidAt = new Date().toISOString();
        await db
          .from('settings')
          .update({ value: JSON.stringify(config) })
          .eq('key', 'whatsapp_config');
        console.warn('[WhatsApp] Token invalid — WhatsApp notifikasi otomatis dinonaktifkan.');
      }
    }
  } catch (err) {
    console.error('[WhatsApp] Failed to auto-disable:', err);
  }
}

/**
 * Render message template with provided variables
 * Replaces {variable_name} placeholders with actual values
 */
export function renderMessageTemplate(template: string, variables: MessageTemplateVariables): string {
  let rendered = template;

  Object.entries(variables).forEach(([key, value]) => {
    rendered = rendered.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '');
  });

  return rendered;
}

/**
 * Convenience wrapper: send WhatsApp message using config from DB.
 * Automatically fetches token and target from settings.
 * Used by notifications, etc.
 */
export async function sendWhatsAppMessage(params: {
  phone?: string;
  message: string;
  target?: string;
}): Promise<{ success: boolean; error?: string }> {
  const config = await getWhatsAppConfig();
  if (!config.token || !config.enabled) {
    return { success: false, error: 'WhatsApp tidak diaktifkan' };
  }
  const target = params.target || params.phone || config.target_id;
  if (!target) {
    return { success: false, error: 'Target WhatsApp tidak tersedia' };
  }
  const result = await sendMessage(config.token, target, params.message);
  if (result.tokenInvalid) {
    await disableWhatsAppOnInvalidToken();
  }
  return { success: result.success, error: result.error };
}

// formatCurrency and formatDate are available from '@/lib/erp-helpers'
