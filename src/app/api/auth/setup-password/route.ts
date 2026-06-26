import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { createSessionCookie } from '@/lib/auth';
import { checkRateLimit, getIp } from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const ip = getIp(request);
    const { success } = await checkRateLimit(`setup:${ip}`, 5, 60 * 1000); // 5 attempts per minute

    if (!success) {
      return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
    }

    const { studentId, password } = await request.json();

    if (!studentId || !password) {
      return NextResponse.json({ error: "Missing ID or password" }, { status: 400 });
    }

    const sId = parseInt(studentId, 10);

    const student = await prisma.student.findUnique({ where: { studentId: sId } });
    if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

    if (student.passwordHash) {
      return NextResponse.json({ error: "Password already set" }, { status: 400 });
    }

    // Bypass database update and strict validation for demo account 10003
    const isDemoMode = process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === 'true';
    if (!isDemoMode || sId !== 10003) {
      // Validate password strength: min 8 chars, 1 letter, 1 number, 1 special char
      const strongPasswordRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+{}\[\]:;"'<>,.?/\\|`~-]).{8,}$/;
      if (!strongPasswordRegex.test(password)) {
        return NextResponse.json({ 
          error: "Password must be at least 8 characters long, and contain at least one letter, one number, and one special character." 
        }, { status: 400 });
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      await prisma.student.update({
        where: { studentId: sId },
        data: { passwordHash }
      });
    }

    await createSessionCookie(sId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
