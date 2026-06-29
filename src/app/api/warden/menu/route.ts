import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getWardenSession } from '@/lib/auth';

// GET /api/warden/menu?date=YYYY-MM-DD
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dateStr = searchParams.get('date');

    if (!dateStr) {
      return NextResponse.json({ error: "Missing date parameter" }, { status: 400 });
    }

    const menu = await prisma.dailyMenu.findUnique({
      where: { date: dateStr }
    });

    return NextResponse.json({ menu: menu || null });
  } catch (error) {
    console.error("Error fetching menu:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/warden/menu
export async function POST(request: Request) {
  try {
    const wardenSession = await getWardenSession();
    if (!wardenSession) {
      return NextResponse.json({ error: "Unauthorized Warden Access" }, { status: 401 });
    }

    const body = await request.json();
    const { date, breakfast, lunch, dinner } = body;

    if (!date) {
      return NextResponse.json({ error: "Date is required" }, { status: 400 });
    }

    const menu = await prisma.dailyMenu.upsert({
      where: { date },
      update: {
        breakfast: breakfast || null,
        lunch: lunch || null,
        dinner: dinner || null,
      },
      create: {
        date,
        breakfast: breakfast || null,
        lunch: lunch || null,
        dinner: dinner || null,
      }
    });

    return NextResponse.json({ success: true, menu });
  } catch (error) {
    console.error("Error saving menu:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
