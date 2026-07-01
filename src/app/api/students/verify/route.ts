import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { getWardenSession } from '@/lib/auth';
import { getLocalDate } from '@/lib/timezone';
import { Redis } from '@upstash/redis';
import { checkRateLimit, getIp } from '@/lib/rate-limit';
import { z } from 'zod';

const redis = Redis.fromEnv();
import { verifyTOTP } from '@/lib/totp';

const verifySchema = z.object({
  token: z.string(),
  date: z.string().optional(),
  autoRedeem: z.boolean().optional(),
});

function generateHMAC(data: string): string {
  const secret = process.env.QR_SECRET;
  if (!secret) throw new Error('QR_SECRET environment variable is required');
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

export async function POST(request: Request) {
  try {
    const ip = getIp(request);
    const { success: rateSuccess } = await checkRateLimit(`verify:${ip}`, 30, 60 * 1000);
    if (!rateSuccess) {
      return NextResponse.json({ error: "Too many scan attempts" }, { status: 429 });
    }

    const wardenSession = await getWardenSession();
    if (!wardenSession) {
      return NextResponse.json({ error: "Unauthorized Warden Access" }, { status: 401 });
    }

    const body = await request.json();
    const parseResult = verifySchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    const { token, date, autoRedeem } = parseResult.data;

    const targetDate = date || getLocalDate();
    let studentId = 0;
    let mealSlot = '';
    let computedHash = '';
    let isTotpVerified = false;
    let verifiedTotpToken = '';

    try {
      if (token.startsWith('{')) {
        const parsed = JSON.parse(token);
        if (parsed.s && parsed.m && parsed.t) {
          studentId = parsed.s;
          mealSlot = parsed.m;
          verifiedTotpToken = parsed.t;

          const isBurned = await redis.get(`burned_totp:${verifiedTotpToken}`);
          if (isBurned) {
             return NextResponse.json({ valid: false, error: "QR Code already used (Replay attack prevented)." }, { status: 403 });
          }

          const studentSecret = generateHMAC(studentId.toString());
          if (verifyTOTP(verifiedTotpToken, studentSecret, 30, [1, 0])) {
            isTotpVerified = true;
          } else {
            return NextResponse.json({ valid: false, error: "Dynamic QR Code has expired or is invalid." }, { status: 400 });
          }
        }
      }
    } catch (e) {
      // Ignore JSON parse errors, fall back to legacy formats
    }

    // Fallback logic for legacy raw codes and static HMAC hashes
    if (!isTotpVerified) {
      const rawCodePattern = /^\d{5}-\d{4}-\d{2}-\d{2}-\d{2}$/;
      
      if (rawCodePattern.test(token)) {
        // It is a raw code
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

    if (isTotpVerified && verifiedTotpToken) {
      try {
        await redis.set(`burned_totp:${verifiedTotpToken}`, 'used', { ex: 60 });
      } catch (e) {
        console.error('Failed to burn TOTP token:', e);
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
