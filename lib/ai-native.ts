// =====================================================================
// AI NATIVE — Direct HTTP calls to AI API
// No external SDK dependency — lightweight, no config file needed at build time.
// =====================================================================

const AI_BASE_URL = process.env.AI_BASE_URL || 'http://172.25.136.193:8080/v1';
const AI_API_KEY = process.env.AI_API_KEY || 'Z.ai';

interface AiConfig {
  baseUrl: string;
  apiKey: string;
  chatId?: string;
  token?: string;
  userId?: string;
}

function getAiConfig(): AiConfig {
  return {
    baseUrl: AI_BASE_URL,
    apiKey: AI_API_KEY,
  };
}

function aiHeaders(config: AiConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`,
    'X-Z-AI-From': 'Z',
  };
  return headers;
}

// --- TTS (Text-to-Speech) ---
export async function textToSpeech(
  input: string,
  options?: { voice?: string; speed?: number; response_format?: string }
): Promise<ArrayBuffer> {
  const config = getAiConfig();
  const url = `${config.baseUrl}/audio/tts`;
  const res = await fetch(url, {
    method: 'POST',
    headers: aiHeaders(config),
    body: JSON.stringify({
      input,
      voice: options?.voice || 'tongtong',
      speed: options?.speed || 1.0,
      response_format: options?.response_format || 'mp3',
      stream: false,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`TTS API error ${res.status}: ${text}`);
  }
  return res.arrayBuffer();
}

// --- Image Generation ---
export interface ImageGenerationResult {
  base64: string;
}

export async function generateImage(
  prompt: string,
  options?: { size?: string }
): Promise<{ data: ImageGenerationResult[] }> {
  const config = getAiConfig();
  const url = `${config.baseUrl}/images/generations`;
  const res = await fetch(url, {
    method: 'POST',
    headers: aiHeaders(config),
    body: JSON.stringify({
      prompt,
      size: options?.size || '1024x1024',
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Image API error ${res.status}: ${text}`);
  }
  return res.json();
}
