import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

// Initialize Upstash Redis and Ratelimit (10 requests per 30 seconds)
// This is fully Edge compatible and uses UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(500, '30 s'),
  analytics: true,
  /**
   * Optional prefix for the keys used in redis. This is useful if you want to share a redis
   * instance with other applications and want to avoid key collisions. The default prefix is
   * @upstash/ratelimit
   */
  prefix: '@upstash/ratelimit',
});

export async function proxy(request: NextRequest) {
  // Only apply to POST /api/students routes (warden check-ins)
  // We skip rate limiting for GET because students poll this route, which would exhaust Redis limits and block campus IPs
  if (!request.nextUrl.pathname.startsWith('/api/students') || request.method !== 'POST') {
    return NextResponse.next();
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() 
    || request.headers.get('x-real-ip')?.trim() 
    || '127.0.0.1';

  try {
    const { success, limit, reset, remaining } = await ratelimit.limit(`campusbytes_api_${ip}`);

    if (!success) {
      return new NextResponse(
        JSON.stringify({ error: "Rate limit exceeded. Please wait 30 seconds." }),
        { 
          status: 429, 
          headers: { 
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': reset.toString()
          } 
        }
      );
    }
    
    // Pass headers to the node API just in case we need them downstream
    const res = NextResponse.next();
    res.headers.set('X-RateLimit-Limit', limit.toString());
    res.headers.set('X-RateLimit-Remaining', remaining.toString());
    res.headers.set('X-RateLimit-Reset', reset.toString());
    return res;

  } catch (err) {
    // If Redis goes down or there's a network issue, fail open (allow request)
    console.error("Redis Rate Limiter Error:", err);
    return NextResponse.next();
  }
}

// Ensure this runs on Edge
export const config = {
  matcher: '/api/students/:path*',
};
