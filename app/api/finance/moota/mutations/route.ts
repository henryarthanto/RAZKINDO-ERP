import { NextRequest, NextResponse } from 'next/server';
import { getMootaMutations, isMootaConfigured } from '@/lib/moota';
import { verifyAndGetAuthUser } from '@/lib/token';

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAndGetAuthUser(request.headers.get('authorization'), { role: true });
    if (!authResult || !['super_admin', 'keuangan'].includes(authResult.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isMootaConfigured()) {
      return NextResponse.json({ error: 'Moota API belum dikonfigurasi' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const bankId = searchParams.get('bankId');
    const page = parseInt(searchParams.get('page') || '1');
    const perPage = parseInt(searchParams.get('perPage') || '50');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const type = searchParams.get('type') as 'CR' | 'DB' | null;

    if (!bankId) {
      return NextResponse.json({ error: 'bankId diperlukan' }, { status: 400 });
    }

    const result = await getMootaMutations(bankId, {
      page,
      perPage,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      type: type || undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Moota] Error fetching mutations:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Gagal mengambil mutasi dari Moota' },
      { status: 500 }
    );
  }
}
