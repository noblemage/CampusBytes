import { NextResponse } from 'next/server';
import { clearWardenSessionCookie } from '@/lib/auth';

export async function POST() {
  await clearWardenSessionCookie();
  return NextResponse.json({ success: true });
}
