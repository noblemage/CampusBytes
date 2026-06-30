import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

// GET /api/students/redemptions?id=XXXXX&date=YYYY-MM-DD
// Lightweight polling endpoint — only returns mealSlot status.
// Used by the student QR view to detect check-ins without re-fetching all dashboard data.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const idStr = searchParams.get('id');
    const dateStr = searchParams.get('date');

    if (!idStr || !dateStr) {
      return NextResponse.json({ error: 'Missing id or date' }, { status: 400 });
    }

    const studentId = parseInt(idStr, 10);
    if (isNaN(studentId)) {
      return NextResponse.json({ error: 'Invalid student ID' }, { status: 400 });
    }

    const session = await getSession();
    if (!session || session.studentId !== studentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const redemptions = await prisma.mealRedemption.findMany({
      where: { studentId, date: dateStr },
      select: { mealSlot: true }
    });

    const response = NextResponse.json({ redemptions });
    response.headers.set('Cache-Control', 'private, max-age=2');
    return response;
  } catch (error) {
    console.error('Error fetching redemptions:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
