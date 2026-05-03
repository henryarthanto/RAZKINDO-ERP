import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { rowsToCamelCase } from '@/lib/supabase-helpers';

// Keys that should never be exposed to the client
const SENSITIVE_KEYS = ['whatsapp_config', 'whatsapp_message_template', 'bank_credentials', 'api_keys'];

// Keys safe for public access (used by login page before auth)
const PUBLIC_KEYS = ['company_name', 'company_logo', 'login_warning'];

export async function GET(request: NextRequest) {
  try {
    // Allow public access to certain settings (login page needs company info)
    const authHeader = request.headers.get('authorization');
    const { searchParams } = new URL(request.url);
    const publicOnly = searchParams.get('public') === 'true';

    let settings;
    if (publicOnly) {
      // Public mode: only return safe keys (no auth needed)
      const { data } = await db
        .from('settings')
        .select('*')
        .in('key', PUBLIC_KEYS);
      settings = data;
    } else {
      // Full mode: require auth, return all non-sensitive keys
      const { verifyAuthUser } = await import('@/lib/token');
      const authUserId = await verifyAuthUser(authHeader);
      if (!authUserId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const { data } = await db
        .from('settings')
        .select('*');
      settings = data;
    }
    
    const settingsMap: Record<string, any> = {};
    (settings || []).forEach((s: any) => {
      // Skip sensitive keys
      if (SENSITIVE_KEYS.includes(s.key)) return;
      try {
        settingsMap[s.key] = JSON.parse(s.value);
      } catch {
        // If JSON.parse fails (e.g. corrupted data), use raw string value
        settingsMap[s.key] = s.value;
      }
    });

    // Special handling: ensure company_logo is always a valid data URL string or empty
    if (settingsMap.company_logo) {
      if (typeof settingsMap.company_logo !== 'string') {
        // Somehow not a string — try to fix
        settingsMap.company_logo = String(settingsMap.company_logo);
      }
      // Validate it starts with 'data:image/' — if not, it's corrupted, clear it
      if (!settingsMap.company_logo.startsWith('data:image/') && !settingsMap.company_logo.startsWith('http')) {
        console.warn('[Settings] company_logo is corrupted, clearing it');
        settingsMap.company_logo = '';
      }
    }

    return NextResponse.json({ settings: settingsMap }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (error) {
    console.error('Get settings error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}
