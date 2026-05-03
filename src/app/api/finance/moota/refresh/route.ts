import { NextRequest, NextResponse } from 'next/server';
import { refreshMootaBank, isMootaConfigured } from '@/lib/moota';
import { verifyAndGetAuthUser } from '@/lib/token';

export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAndGetAuthUser(request.headers.get('authorization'), { role: true });
    if (!authResult || !['super_admin', 'keuangan'].includes(authResult.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isMootaConfigured()) {
      return NextResponse.json({ error: 'Moota API belum dikonfigurasi' }, { status: 400 });
    }

    const body = await request.json();
    const { bankId } = body;

    if (!bankId) {
      return NextResponse.json({ error: 'bankId diperlukan' }, { status: 400 });
    }

    const result = await refreshMootaBank(bankId);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Moota] Error refreshing bank:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Gagal refresh mutasi bank' },
      { status: 500 }
    );
  }
}
