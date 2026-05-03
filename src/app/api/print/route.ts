import { NextResponse } from 'next/server';
import { printToUSB, printReceiptToUSB, getPrinterInfo } from '@/lib/server-printer';

// POST /api/print — Send raw ESC/POS data to USB printer
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, data, text, device } = body;

    // GET printer status if requested
    if (type === 'status') {
      const info = await getPrinterInfo();
      return NextResponse.json({ success: true, printer: info });
    }

    // Print raw ESC/POS bytes
    if (type === 'raw' && data) {
      const bytes = typeof data === 'string'
        ? new Uint8Array(Buffer.from(data, 'base64'))
        : new Uint8Array(data);

      const result = await printToUSB(bytes, device);
      return NextResponse.json(result);
    }

    // Print receipt text (auto-wraps with ESC/POS)
    if (type === 'receipt' && text) {
      const result = await printReceiptToUSB(text, device);
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { success: false, error: 'Invalid request. Use type: "status", "raw", or "receipt"' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[PrintAPI] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mencetak: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}

// GET /api/print — Get printer status
export async function GET() {
  try {
    const info = await getPrinterInfo();
    return NextResponse.json({
      success: true,
      printer: info,
      stbMode: true,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Gagal mendeteksi printer' },
      { status: 500 }
    );
  }
}
