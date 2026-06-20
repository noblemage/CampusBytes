import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { getWardenSession } from '@/lib/auth';

const SECRET_KEY = 'Janet123';

// Helper to generate HMAC-SHA256 hash
function generateHMAC(data: string): string {
  return crypto.createHmac('sha256', SECRET_KEY).update(data).digest('hex');
}

// POST /api/students/verify
// Accepts a token (can be HMAC hash OR raw code) and verifies its validity
export async function POST(request: Request) {
  try {
    const wardenSession = await getWardenSession();
    if (!wardenSession) {
      return NextResponse.json({ error: "Unauthorized Warden Access" }, { status: 401 });
    }

    const body = await request.json();
    const { token, date } = body; // token can be the hash or the raw code like "10001-2026-06-18-01"

    if (!token) {
      return NextResponse.json({ error: "Missing token to verify" }, { status: 400 });
    }

    const targetDate = date || new Date().toISOString().split('T')[0];

    // Check if token is a raw code (contains dashes and has the studentId format)
    const rawCodePattern = /^\d{5}-\d{4}-\d{2}-\d{2}-\d{2}$/;
    
    let studentId = 0;
    let mealSlot = '';
    let isRawCode = false;
    let computedHash = '';

    if (rawCodePattern.test(token)) {
      // It is a raw code
      isRawCode = true;
      const parts = token.split('-');
      studentId = parseInt(parts[0], 10);
      mealSlot = parts[4];
      computedHash = generateHMAC(token);
    } else {
      // It is likely a 64-char hex HMAC token. We need to find which student and slot it corresponds to.
      // Search all students. (In a real system with thousands of students, we could index or use a prefix,
      // but scanning all students is extremely fast in SQLite for typical campus sizes).
      const allStudents = await prisma.student.findMany();
      
      let foundMatch = false;

      for (const student of allStudents) {
        // Only generate for paid students to optimize and enforce payment
        if (student.paidStatus !== 1) continue;

        const slots = ['01', '02', '03'];
        for (const slot of slots) {
          const rawString = `${student.studentId}-${targetDate}-${slot}`;
          const hashVal = generateHMAC(rawString);
          
          if (hashVal === token) {
            studentId = student.studentId;
            mealSlot = slot;
            computedHash = hashVal;
            foundMatch = true;
            break;
          }
        }
        if (foundMatch) break;
      }

      if (!foundMatch) {
        return NextResponse.json({ 
          valid: false, 
          error: "Invalid token or code doesn't match any paid student for this date." 
        }, { status: 404 });
      }
    }

    // Now verify the student details in database
    const student = await prisma.student.findUnique({
      where: { studentId }
    });

    if (!student) {
      return NextResponse.json({ valid: false, error: "Student associated with code not found." }, { status: 404 });
    }

    if (student.paidStatus !== 1) {
      return NextResponse.json({ valid: false, student, error: "Mess fees are unpaid for this student." }, { status: 403 });
    }

    // Check if already redeemed
    const existingRedemption = await prisma.mealRedemption.findUnique({
      where: {
        studentId_date_mealSlot: {
          studentId,
          date: targetDate,
          mealSlot
        }
      }
    });

    const mealName = mealSlot === '01' ? 'Breakfast' : mealSlot === '02' ? 'Lunch' : 'Dinner';

    return NextResponse.json({
      valid: true,
      redeemed: !!existingRedemption,
      redeemedAt: existingRedemption?.redeemedAt || null,
      student,
      mealSlot,
      mealName,
      date: targetDate,
      hash: computedHash,
      rawCode: `${studentId}-${targetDate}-${mealSlot}`
    });

  } catch (error) {
    console.error("Error verifying token:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
