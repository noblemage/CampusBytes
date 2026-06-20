import { prisma } from '@/lib/prisma';

/**
 * Database-backed rate limiter that works correctly on serverless platforms.
 * 
 * Uses the RateLimit table in PostgreSQL to persist counters across
 * Vercel function invocations, unlike in-memory Maps which reset
 * every time a new serverless instance spins up.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ success: boolean; limit: number; remaining: number; resetAt: number }> {
  const now = Date.now();

  try {
    // Try to find existing rate limit record
    const existing = await prisma.rateLimit.findUnique({
      where: { key }
    });

    if (!existing || now > existing.resetAt) {
      // No record or window expired — create/reset
      await prisma.rateLimit.upsert({
        where: { key },
        update: { count: 1, resetAt: now + windowMs },
        create: { key, count: 1, resetAt: now + windowMs }
      });
      return { success: true, limit, remaining: limit - 1, resetAt: now + windowMs };
    }

    if (existing.count >= limit) {
      return { success: false, limit, remaining: 0, resetAt: existing.resetAt };
    }

    // Increment counter
    await prisma.rateLimit.update({
      where: { key },
      data: { count: existing.count + 1 }
    });

    return {
      success: true,
      limit,
      remaining: limit - (existing.count + 1),
      resetAt: existing.resetAt,
    };
  } catch (error) {
    // If the database is unreachable, fail open (allow the request)
    // but log the error. This prevents the rate limiter from
    // accidentally locking out all users during a DB outage.
    console.error('Rate limit check failed:', error);
    return { success: true, limit, remaining: limit, resetAt: now + windowMs };
  }
}

export function getIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }
  return '127.0.0.1';
}
