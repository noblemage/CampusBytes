import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getWardenSession } from '@/lib/auth';
import { checkRateLimit, getIp } from '@/lib/rate-limit';
import { z } from 'zod';

const updateSchema = z.object({
  orderId: z.number(),
  status: z.string(),
});

export async function POST(request: Request) {
  try {
    const ip = getIp(request);
    const { success } = await checkRateLimit(`vendor_update:${ip}`, 20, 60 * 1000); // 20 requests per minute
    if (!success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const session = await getWardenSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const warden = await prisma.warden.findUnique({
      where: { id: session.wardenId }
    });

    if (!warden || warden.role !== 'VENDOR_ADMIN' || !warden.vendorId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await request.json();
    const parseResult = updateSchema.safeParse(body);
    
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
    }
    const { orderId, status } = parseResult.data;

    // Ensure the order belongs to this vendor
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.vendorId !== warden.vendorId) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: { status }
    });

    return NextResponse.json({ success: true, order: updatedOrder });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
