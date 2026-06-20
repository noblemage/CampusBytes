import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, getIp } from '@/lib/rate-limit';

export async function GET(request: Request) {
  const ip = getIp(request);
  const { success } = await checkRateLimit(`check:${ip}`, 10, 60 * 1000); // 10 lookups per minute

  if (!success) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const idStr = searchParams.get('id');

  if (!idStr) return NextResponse.json({ error: "Missing student ID" }, { status: 400 });

  const studentId = parseInt(idStr, 10);
  if (isNaN(studentId) || idStr.length !== 5) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const student = await prisma.student.findUnique({ where: { studentId } });
  
  if (!student) {
    // Return a generic error that doesn't reveal whether the ID exists
    return NextResponse.json({ error: "Invalid credentials." }, { status: 404 });
  }

  return NextResponse.json({
    exists: true,
    hasPasswordSet: !!student.passwordHash,
    name: student.name
  });
}
