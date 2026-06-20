import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { createWardenSessionCookie } from '@/lib/auth';
import { checkRateLimit, getIp } from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const ip = getIp(request);
    const { success } = await checkRateLimit(`warden:${ip}`, 5, 60 * 1000); // 5 requests per minute
    
    if (!success) {
      return NextResponse.json({ error: "Too many login attempts. Please try again later." }, { status: 429 });
    }

    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ error: "Missing username or password" }, { status: 400 });
    }

    const warden = await prisma.warden.findUnique({ where: { username } });
    
    if (!warden) {
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    const isValid = await bcrypt.compare(password, warden.passwordHash);
    if (!isValid) {
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    await createWardenSessionCookie(warden.id);

    return NextResponse.json({ success: true, name: warden.name });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
