import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { createSessionCookie } from '@/lib/auth';

export async function POST(request: Request) {
  try {
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
