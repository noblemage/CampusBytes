import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { getWardenSession } from '@/lib/auth';
import { getLocalDate } from '@/lib/timezone';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

// Helper to generate HMAC-SHA256 hash
function generateHMAC(data: string): string {
  const secret = process.env.QR_SECRET;
  if (!secret) throw new Error('QR_SECRET environment variable is required');
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
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
    const { token, date, autoRedeem } = body; // token can be the hash or the raw code like "10001-2026-06-18-01"

    if (!token) {
      return NextResponse.json({ error: "Missing token to verify" }, { status: 400 });
    }

    const targetDate = date || getLocalDate();

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
      let foundMatch = false;

      // OPTIMIZED O(1) LOOKUP: Check if the token is prefixed with a student ID (e.g., "10001:hash")
      if (token.includes(':')) {
        const parts = token.split(':');
        const sId = parseInt(parts[0], 10);
        const hashPart = parts[1];

        if (!isNaN(sId) && hashPart) {
          const student = await prisma.student.findUnique({
            where: { studentId: sId }
          });

          if (student && student.paidStatus === 1) {
            const slots = ['01', '02', '03'];
            for (const slot of slots) {
              const rawString = `${student.studentId}-${targetDate}-${slot}`;
              const hashVal = generateHMAC(rawString);

              if (hashVal === hashPart) {
                studentId = student.studentId;
                mealSlot = slot;
                computedHash = hashVal;
                foundMatch = true;
                break;
              }
            }
          }
        }
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

    let redeemedNow = false;
    let finalRedemption = existingRedemption;

    if (!existingRedemption && autoRedeem) {
      try {
        finalRedemption = await prisma.mealRedemption.create({
          data: { studentId, date: targetDate, mealSlot, wardenId: wardenSession.wardenId }
        });
        redeemedNow = true;

        try {
          await redis.del(`metrics:${targetDate}`);
        } catch (e) {
          console.error('Redis metrics invalidation failed:', e);
        }
      } catch (dbError: any) {
        if (dbError.code === 'P2002') {
          return NextResponse.json({
            valid: true,
            redeemed: true,
            student,
            mealSlot,
            mealName,
            date: targetDate,
            hash: computedHash,
            rawCode: `${studentId}-${targetDate}-${mealSlot}`
          });
        }
        throw dbError;
      }
    }

    return NextResponse.json({
      valid: true,
      redeemed: !!existingRedemption,
      redeemedNow,
      redeemedAt: finalRedemption?.redeemedAt || null,
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
