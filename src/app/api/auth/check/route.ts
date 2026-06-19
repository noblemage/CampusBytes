import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idStr = searchParams.get('id');

  if (!idStr) return NextResponse.json({ error: "Missing student ID" }, { status: 400 });

  const studentId = parseInt(idStr, 10);
  if (isNaN(studentId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  const student = await prisma.student.findUnique({ where: { studentId } });
  
  if (!student) {
    return NextResponse.json({ error: "Student not found in mess roster." }, { status: 404 });
  }

  return NextResponse.json({
    exists: true,
    hasPasswordSet: !!student.passwordHash,
    name: student.name
  });
}
