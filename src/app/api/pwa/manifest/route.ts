import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

const isSTB = process.env.STB_MODE === 'true' || process.env.STB_MODE === '1';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const customerCode = searchParams.get('code');

    const { data: settings, error } = await db.from('settings').select('*');
    if (error) throw error;

    const settingsMap: Record<string, string> = {};
    (settings || []).forEach((s: any) => {
      if (s.key === 'whatsapp_config' || s.key === 'bank_credentials' || s.key === 'api_keys') return;
      try {
        const parsed = JSON.parse(s.value);
        if (typeof parsed === 'string') {
          settingsMap[s.key] = parsed;
        }
      } catch {
        settingsMap[s.key] = s.value;
      }
    });

    const companyName = settingsMap['company_name'] || 'Razkindo ERP';
    const companyLogo = settingsMap['company_logo'] || '';

    // Build icon entries - point to our dynamic icon API
    const icons: Array<{
      src: string;
      sizes: string;
      type: string;
      purpose: string;
    }> = [
      {
        src: '/api/pwa/icon?size=192',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any maskable',
      },
      {
        src: '/api/pwa/icon?size=512',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ];

    // Add the original uploaded logo as a high-res source if available
    if (companyLogo) {
      icons.push({
        src: '/api/pwa/icon?size=1024',
        sizes: '1024x1024',
        type: 'image/png',
        purpose: 'any',
      });
    }

    // ── Customer-specific manifest (when ?code= parameter is present) ──
    let customerName = '';
    if (customerCode) {
      const { data: customer } = await db
        .from('customers')
        .select('name')
        .eq('code', customerCode)
        .maybeSingle();
      customerName = customer?.name || '';
    }

    const isCustomer = !!customerCode && !!customerName;

    const manifest = {
      name: isCustomer
        ? `${companyName} - ${customerName}`
        : companyName,
      short_name: companyName.length > 12 ? companyName.slice(0, 12) : companyName,
      description: isCustomer
        ? `Portal pelanggan ${customerName} - ${companyName}`
        : 'Sistem ERP komprehensif untuk manajemen bisnis multi-unit',
      start_url: isCustomer ? `/c/${customerCode}` : '/',
      display: 'standalone' as const,
      display_override: isSTB
        ? ['window-controls-overlay', 'standalone']
        : ['window-controls-overlay', 'standalone', 'minimal-ui'],
      background_color: isCustomer ? '#f9fafb' : '#0f172a',
      theme_color: isCustomer ? '#0d9488' : '#0f172a',
      orientation: isSTB ? ('landscape' as const) : ('any' as const),
      scope: '/',
      icons,
      categories: isCustomer ? ['business', 'shopping'] : ['business', 'productivity', 'utilities'],
      lang: 'id',
      dir: 'ltr' as const,
      prefer_related_applications: false,
      // STB: prevent navigation away from the app
      ...(isSTB ? { navigation_type: 'in-app' as const } : {}),
    };

    return new NextResponse(JSON.stringify(manifest), {
      status: 200,
      headers: {
        'Content-Type': 'application/manifest+json',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
      },
    });
  } catch (error) {
    console.error('PWA manifest generation error:', error);
    // Return a safe default manifest
    const fallback = {
      name: 'Razkindo ERP',
      short_name: 'Razkindo',
      description: 'Sistem ERP komprehensif untuk manajemen bisnis multi-unit',
      start_url: '/',
      display: 'standalone',
      display_override: isSTB
        ? ['window-controls-overlay', 'standalone']
        : ['window-controls-overlay', 'standalone', 'minimal-ui'],
      background_color: '#0f172a',
      theme_color: '#0f172a',
      orientation: isSTB ? 'landscape' : 'any',
      scope: '/',
      icons: [
        {
          src: '/api/pwa/icon?size=192',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any maskable',
        },
        {
          src: '/api/pwa/icon?size=512',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any maskable',
        },
      ],
      categories: ['business', 'productivity', 'utilities'],
      lang: 'id',
    };

    return new NextResponse(JSON.stringify(fallback), {
      status: 200,
      headers: {
        'Content-Type': 'application/manifest+json',
        'Cache-Control': 'public, max-age=60',
      },
    });
  }
}
