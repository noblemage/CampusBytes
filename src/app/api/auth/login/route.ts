import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { createSessionCookie } from '@/lib/auth';
import { checkRateLimit, getIp } from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const ip = getIp(request);
    const { success } = await checkRateLimit(`login:${ip}`, 5, 60 * 1000); // 5 attempts per minute

    if (!success) {
      return NextResponse.json({ error: "Too many login attempts. Please try again later." }, { status: 429 });
    }

    const { studentId, password } = await request.json();

    if (!studentId || !password) {
      return NextResponse.json({ error: "Missing ID or password" }, { status: 400 });
    }

    const sId = parseInt(studentId, 10);
    const student = await prisma.student.findUnique({ where: { studentId: sId } });
    
    if (!student || !student.passwordHash) {
      return NextResponse.json({ error: "Invalid ID or password" }, { status: 401 });
    }

    const isValid = await bcrypt.compare(password, student.passwordHash);
    if (!isValid) {
      return NextResponse.json({ error: "Invalid ID or password" }, { status: 401 });
    }

    await createSessionCookie(sId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
