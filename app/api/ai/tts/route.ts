import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthUser } from '@/lib/token';
import { textToSpeech } from '@/lib/ai-native';

const MAX_CHUNK_LENGTH = 1024;

export async function POST(request: NextRequest) {
  try {
    // --- Auth check ---
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // --- Parse body ---
    const body = await request.json();
    const { text, voice, speed } = body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'Text wajib diisi' }, { status: 400 });
    }

    const selectedVoice: string = voice || 'tongtong';
    const selectedSpeed: number = typeof speed === 'number' ? Math.max(0.5, Math.min(2.0, speed)) : 1.0;

    // Split text into chunks at sentence boundaries
    const fullText = text.trim();
    const chunks: string[] = [];
    if (fullText.length <= MAX_CHUNK_LENGTH) {
      chunks.push(fullText);
    } else {
      let remaining = fullText;
      while (remaining.length > 0) {
        if (remaining.length <= MAX_CHUNK_LENGTH) {
          chunks.push(remaining);
          break;
        }
        let splitAt = -1;
        const searchArea = remaining.substring(0, MAX_CHUNK_LENGTH);
        const boundaries = ['\n', '。', '！', '？', '.', '!', '?', '；', ';'];
        for (const b of boundaries) {
          const lastIdx = searchArea.lastIndexOf(b);
          if (lastIdx > splitAt) splitAt = lastIdx;
        }
        if (splitAt === -1) splitAt = MAX_CHUNK_LENGTH;
        chunks.push(remaining.substring(0, splitAt + 1).trim());
        remaining = remaining.substring(splitAt + 1).trim();
      }
    }

    // Generate audio for each chunk using native HTTP call
    const audioBuffers: ArrayBuffer[] = [];
    for (const chunk of chunks) {
      const arrayBuffer = await textToSpeech(chunk, {
        voice: selectedVoice,
        speed: selectedSpeed,
      });
      audioBuffers.push(arrayBuffer);
    }

    // Concatenate all audio chunks
    const totalLength = audioBuffers.reduce((sum, buf) => sum + buf.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of audioBuffers) {
      combined.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }

    return new NextResponse(combined, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(totalLength),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Gagal menghasilkan audio';
    console.error('TTS error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
