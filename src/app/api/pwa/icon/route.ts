import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { db } from '@/lib/supabase';
import { toCamelCase } from '@/lib/supabase-helpers';

export const dynamic = 'force-dynamic';
const CACHE_MAX_AGE = 300;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const size = Math.min(Math.max(parseInt(searchParams.get('size') || '192') || 192, 48), 1024);

    const { data: logoSetting } = await db.from('settings').select('*').eq('key', 'company_logo').maybeSingle();

    let logoData: string | null = null;
    if (logoSetting?.value) {
      logoData = logoSetting.value;
      try { const parsed = JSON.parse(logoData!); if (typeof parsed === 'string') logoData = parsed; } catch { /* not JSON */ }
    }

    if (!logoData) return await generateFallbackIcon(size);

    const base64Match = logoData.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!base64Match) return await generateFallbackIcon(size);

    const imageBuffer = Buffer.from(base64Match[2], 'base64');
    const resizedBuffer = await sharp(imageBuffer).resize(size, size, { fit: 'contain', background: { r: 15, g: 23, b: 42, alpha: 1 } }).png().toBuffer();

    return new Response(resizedBuffer as unknown as BodyInit, {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': `public, max-age=${CACHE_MAX_AGE}, stale-while-revalidate=3600`, 'Content-Length': resizedBuffer.length.toString() },
    });
  } catch (error) {
    console.error('PWA icon generation error:', error);
    const size = parseInt(new URL(request.url).searchParams.get('size') || '192');
    try { return await generateFallbackIcon(size); } catch { return new Response('Icon error', { status: 500 }); }
  }
}

async function generateFallbackIcon(size: number): Promise<Response> {
  const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" rx="${Math.round(size * 0.2)}" fill="#0f172a"/>
    <text x="50%" y="50%" font-family="system-ui, sans-serif" font-size="${Math.round(size * 0.35)}" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="central">R</text>
  </svg>`;
  const pngBuffer = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  return new Response(pngBuffer as unknown as BodyInit, { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'Content-Length': pngBuffer.length.toString() } });
}
