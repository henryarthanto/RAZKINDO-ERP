import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthUser, invalidateUserAuthCache } from '@/lib/token';

export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (userId) {
      // Invalidate user auth cache so token check forces DB re-verification
      invalidateUserAuthCache(userId);
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true });
  }
}
