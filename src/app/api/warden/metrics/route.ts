import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getWardenSession } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const wardenSession = await getWardenSession();
    if (!wardenSession) {
      return NextResponse.json({ error: "Unauthorized Warden Access" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dateStr = searchParams.get('date') || new Date().toISOString().split('T')[0];

    // Get count metrics
    const redemptionsToday = await prisma.mealRedemption.findMany({
      where: { date: dateStr },
      include: {
        student: {
          select: { name: true }
        },
        warden: {
          select: { name: true, username: true }
        }
      },
      orderBy: { redeemedAt: 'desc' }
    });

    const breakfastCount = redemptionsToday.filter(r => r.mealSlot === '01').length;
    const lunchCount = redemptionsToday.filter(r => r.mealSlot === '02').length;
    const dinnerCount = redemptionsToday.filter(r => r.mealSlot === '03').length;

    return NextResponse.json({
      date: dateStr,
      metrics: {
        breakfast: breakfastCount,
        lunch: lunchCount,
        dinner: dinnerCount,
        total: redemptionsToday.length
      },
      recentRedemptions: redemptionsToday.slice(0, 15) // Return last 15 redemptions
    });
  } catch (error: any) {
    console.error("Error retrieving warden metrics:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
