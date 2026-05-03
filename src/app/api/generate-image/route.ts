import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthUser } from '@/lib/token';
import { generateImage } from '@/lib/ai-native';

const DEFAULT_PROMPT =
  'professional product photography, white background, studio lighting, high quality, commercial';

export async function POST(request: NextRequest) {
  try {
    // --- Auth check ---
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // --- Parse body ---
    const body = await request.json();
    const prompt: string = body.prompt?.trim() || DEFAULT_PROMPT;

    const response = await generateImage(prompt, { size: '1024x1024' });

    const imageBase64 = response.data[0]?.base64;
    if (!imageBase64) {
      return NextResponse.json({ error: 'Failed to generate image' }, { status: 500 });
    }

    return NextResponse.json({ imageUrl: `data:image/png;base64,${imageBase64}` });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Generate image error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
