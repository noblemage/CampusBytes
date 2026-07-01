import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const idStr = searchParams.get('id');

    if (!idStr) {
      return NextResponse.json({ error: "Missing student ID" }, { status: 400 });
    }

    const studentId = parseInt(idStr, 10);
    if (isNaN(studentId)) {
      return NextResponse.json({ error: "Invalid student ID format" }, { status: 400 });
    }

    const session = await getSession();
    if (!session || session.studentId !== studentId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const activeOrders = await prisma.order.findMany({
      where: { studentId, status: { not: 'PickedUp' } },
      include: {
        vendor: { select: { name: true } },
        items: {
          include: { menuItem: { select: { name: true } } }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({ activeOrders });
  } catch (error) {
    console.error("Error retrieving active orders:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
