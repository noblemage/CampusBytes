import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getWardenSession } from '@/lib/auth';
import { getLocalDate } from '@/lib/timezone';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export async function GET(request: Request) {
  try {
    const wardenSession = await getWardenSession();
    if (!wardenSession) {
      return NextResponse.json({ error: "Unauthorized Warden Access" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dateStr = searchParams.get('date') || getLocalDate();

    const cacheKey = `metrics:${dateStr}`;
    let payload: any = null;

    try {
      payload = await redis.get(cacheKey);
    } catch (e) {
      console.error('Redis metrics fetch failed:', e);
    }

    if (!payload) {
      // Get count metrics
      const redemptionsToday = await prisma.mealRedemption.findMany({
        where: { date: dateStr },
        include: {
          student: { select: { name: true } },
          warden: { select: { name: true, username: true } }
        },
        orderBy: { redeemedAt: 'desc' }
      });

      payload = {
        date: dateStr,
        metrics: {
          breakfast: redemptionsToday.filter((r: any) => r.mealSlot === '01').length,
          lunch: redemptionsToday.filter((r: any) => r.mealSlot === '02').length,
          dinner: redemptionsToday.filter((r: any) => r.mealSlot === '03').length,
          total: redemptionsToday.length
        },
        recentRedemptions: redemptionsToday.slice(0, 15)
      };

      try {
        await redis.set(cacheKey, payload, { ex: 60 });
      } catch (e) {
        console.error('Redis metrics set failed:', e);
      }
    }

    const response = NextResponse.json(payload);
    response.headers.set('Cache-Control', 'private, max-age=60');
    return response;
  } catch (error: any) {
    console.error("Error retrieving warden metrics:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
