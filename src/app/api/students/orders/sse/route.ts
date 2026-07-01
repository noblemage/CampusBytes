import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const idStr = searchParams.get('id');

    if (!idStr) {
      return new Response("Missing student ID", { status: 400 });
    }

    const studentId = parseInt(idStr, 10);
    const session = await getSession();
    if (!session || session.studentId !== studentId) {
      return new Response("Unauthorized", { status: 401 });
    }

    const stream = new ReadableStream({
      async start(controller) {
        let isConnected = true;

        request.signal.addEventListener('abort', () => {
          isConnected = false;
        });

        // Polling loop for SSE
        while (isConnected) {
          try {
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
            
            const data = JSON.stringify({ activeOrders });
            controller.enqueue(`data: ${data}\n\n`);
            
            // Wait 10 seconds before polling again
            await new Promise(resolve => setTimeout(resolve, 10000));
          } catch (e) {
            console.error('SSE Error:', e);
            isConnected = false;
          }
        }
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    return new Response("Internal Server Error", { status: 500 });
  }
}
