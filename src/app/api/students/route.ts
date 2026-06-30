import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { getSession, getWardenSession } from '@/lib/auth';
import { getLocalDate } from '@/lib/timezone';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();


function generateHMAC(data: string): string {
  const secret = process.env.QR_SECRET;
  if (!secret) throw new Error('QR_SECRET environment variable is required');
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

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
    const wardenSession = await getWardenSession();
    if (!session && !wardenSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session && session.studentId !== studentId && !wardenSession) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch student
    const student = await prisma.student.findUnique({
      where: { studentId },
      select: {
        studentId: true,
        name: true,
        paidStatus: true,
        _count: {
          select: { authenticators: true }
        }
      }
    });

    let hasBiometrics = false;
    // Remove sensitive fields
    if (student) {
      hasBiometrics = student._count.authenticators > 0;
      delete (student as any)._count;
    }

    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    // Fetch redemptions - only grab mealSlot, it's the only field the student UI needs
    const targetDate = dateStr || getLocalDate();
    const redemptions = await prisma.mealRedemption.findMany({
      where: { studentId, date: targetDate },
      select: { mealSlot: true }
    });

    // Fetch daily menu for the target date (Check Redis cache first)
    let dailyMenu = null;
    const redisKey = `menu:${targetDate}`;
    try {
      dailyMenu = await redis.get(redisKey);
    } catch (e) {
      console.error("Redis fetch failed:", e);
    }

    if (!dailyMenu) {
      dailyMenu = await prisma.dailyMenu.findUnique({
        where: { date: targetDate }
      });
      if (dailyMenu) {
        try {
          // Cache in Redis for 24 hours (86400 seconds)
          await redis.set(redisKey, dailyMenu, { ex: 86400 });
        } catch (e) {
          console.error("Redis set failed:", e);
        }
      }
    }

    // Generate secure HMAC QR codes on the server so the secret never touches the client
    const slots = [
      { slot: '01', name: 'Breakfast' },
      { slot: '02', name: 'Lunch' },
      { slot: '03', name: 'Dinner' }
    ];
    
    let mealCodes: { slot: string; name: string; raw: string; hash: string }[] = [];
    let totpSecret = null;
    
    if (student && student.paidStatus === 1) {
      mealCodes = slots.map((item) => {
        const raw = `${student.studentId}-${targetDate}-${item.slot}`;
        const hash = generateHMAC(raw);
        return { slot: item.slot, name: item.name, raw, hash };
      });
      // Generate a deterministic TOTP secret for the student
      totpSecret = generateHMAC(student.studentId.toString());
    }

    const response = NextResponse.json({ student, redemptions, date: targetDate, hasBiometrics, mealCodes, dailyMenu, totpSecret });
    response.headers.set('Cache-Control', 'private, max-age=5');
    return response;
  } catch (error) {
    console.error("Error retrieving student details:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/students
// Redeems a meal slot for a student
export async function POST(request: Request) {
  try {
    const wardenSession = await getWardenSession();
    if (!wardenSession) {
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
      return NextResponse.json({ error: "Mess fees unpaid. Meal check-in blocked." }, { status: 403 });
    }

    // Check if slot is valid ('01', '02', '03')
    if (!['01', '02', '03'].includes(mealSlot)) {
      return NextResponse.json({ error: "Invalid meal slot. Must be '01' (Breakfast), '02' (Lunch), or '03' (Dinner)." }, { status: 400 });
    }

    // Create redemption record (Unique constraint prevents double redemption)
    try {
      const redemption = await prisma.mealRedemption.create({
        data: { studentId: sId, date, mealSlot, wardenId: wardenSession.wardenId }
      });

      // Invalidate the metrics cache so the warden dashboard reflects the new check-in within the next refresh cycle
      try {
        await redis.del(`metrics:${date}`);
      } catch (e) {
        console.error('Redis metrics invalidation failed:', e);
      }

      return NextResponse.json({ success: true, redemption });
    } catch (dbError: any) {
      // Unique constraint code in prisma is P2002
      if (dbError.code === 'P2002') {
        return NextResponse.json({ error: "This meal slot has already been checked in for today." }, { status: 400 });
      }
      throw dbError;
    }
  } catch (error: any) {
    console.error("Error saving redemption:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
