import { NextRequest, NextResponse } from 'next/server';
import { getMootaBanks, isMootaConfigured } from '@/lib/moota';
import { verifyAndGetAuthUser } from '@/lib/token';

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAndGetAuthUser(request.headers.get('authorization'), { role: true });
    if (!authResult || !['super_admin', 'keuangan'].includes(authResult.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isMootaConfigured()) {
      return NextResponse.json({ error: 'Moota API belum dikonfigurasi. Tambahkan MOOTA_PERSONAL_TOKEN di .env.local' }, { status: 400 });
    }

    const banks = await getMootaBanks();
    return NextResponse.json({ banks });
  } catch (error) {
    console.error('[Moota] Error fetching banks:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Gagal mengambil data bank dari Moota' },
      { status: 500 }
    );
  }
}
