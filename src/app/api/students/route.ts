import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

// GET /api/students?id=XXXXX&date=YYYY-MM-DD
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const idStr = searchParams.get('id');
    const dateStr = searchParams.get('date'); // e.g. "2026-06-18"

    if (!idStr) {
      return NextResponse.json({ error: "Missing student ID" }, { status: 400 });
    }

    const studentId = parseInt(idStr, 10);
    if (isNaN(studentId)) {
      return NextResponse.json({ error: "Invalid student ID format" }, { status: 400 });
    }

    const session = await getSession();
    const wardenAuth = request.headers.get('x-warden-auth');
    if (!session && wardenAuth !== '1234') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session && session.studentId !== studentId && wardenAuth !== '1234') {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch student
    const student = await prisma.student.findUnique({
      where: { studentId },
      include: { authenticators: true }
    });

    let hasBiometrics = false;
    // Remove sensitive fields
    if (student) {
      hasBiometrics = student.authenticators.length > 0;
      delete (student as any).passwordHash;
      delete (student as any).currentWebAuthnChallenge;
      delete (student as any).authenticators;
    }

    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    // Fetch redemptions for the student on the given date (default to today if not provided)
    const targetDate = dateStr || new Date().toISOString().split('T')[0];
    const redemptions = await prisma.mealRedemption.findMany({
      where: {
        studentId,
        date: targetDate
      }
    });

    return NextResponse.json({ student, redemptions, date: targetDate, hasBiometrics });
  } catch (error) {
    console.error("Error retrieving student details:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/students
// Redeems a meal slot for a student
export async function POST(request: Request) {
  try {
    const wardenAuth = request.headers.get('x-warden-auth');
    if (wardenAuth !== '1234') {
      return NextResponse.json({ error: "Unauthorized Warden Access" }, { status: 401 });
    }

    const body = await request.json();
    const { studentId, date, mealSlot } = body;

    if (!studentId || !date || !mealSlot) {
      return NextResponse.json({ error: "Missing required fields (studentId, date, mealSlot)" }, { status: 400 });
    }

    const sId = parseInt(studentId, 10);
    if (isNaN(sId)) {
      return NextResponse.json({ error: "Invalid student ID" }, { status: 400 });
    }

    // Verify student exists and has paid
    const student = await prisma.student.findUnique({
      where: { studentId: sId }
    });

    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    if (student.paidStatus !== 1) {
      return NextResponse.json({ error: "Mess fees unpaid. Meal redemption blocked." }, { status: 403 });
    }

    // Check if slot is valid ('01', '02', '03')
    if (!['01', '02', '03'].includes(mealSlot)) {
      return NextResponse.json({ error: "Invalid meal slot. Must be '01' (Breakfast), '02' (Lunch), or '03' (Dinner)." }, { status: 400 });
    }

    // Create redemption record (Unique constraint prevents double redemption)
    try {
      const redemption = await prisma.mealRedemption.create({
        data: {
          studentId: sId,
          date,
          mealSlot
        }
      });
      return NextResponse.json({ success: true, redemption });
    } catch (dbError: any) {
      // Unique constraint code in prisma is P2002
      if (dbError.code === 'P2002') {
        return NextResponse.json({ error: "This meal slot has already been redeemed for today." }, { status: 400 });
      }
      throw dbError;
    }
  } catch (error: any) {
    console.error("Error saving redemption:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
