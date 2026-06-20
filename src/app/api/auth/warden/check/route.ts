import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getWardenSession } from '@/lib/auth';

export async function GET() {
  const session = await getWardenSession();

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const warden = await prisma.warden.findUnique({
    where: { id: session.wardenId },
    select: { id: true, username: true, name: true }
  });

  if (!warden) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({ authenticated: true, warden });
}
