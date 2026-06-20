type RateLimitInfo = {
  count: number;
  resetAt: number;
};

const limits = new Map<string, RateLimitInfo>();

// Clean up old entries periodically to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, info] of limits.entries()) {
    if (now > info.resetAt) {
      limits.delete(ip);
    }
  }
}, 60000); // Check every minute

export async function checkRateLimit(
  ip: string,
  limit: number,
  windowMs: number
): Promise<{ success: boolean; limit: number; remaining: number; resetAt: number }> {
  const now = Date.now();
  let info = limits.get(ip);

  if (!info || now > info.resetAt) {
    info = {
      count: 1,
      resetAt: now + windowMs,
    };
    limits.set(ip, info);
    return {
      success: true,
      limit,
      remaining: limit - 1,
      resetAt: info.resetAt,
    };
  }

  if (info.count >= limit) {
    return {
      success: false,
      limit,
      remaining: 0,
      resetAt: info.resetAt,
    };
  }

  info.count += 1;
  limits.set(ip, info);

  return {
    success: true,
    limit,
    remaining: limit - info.count,
    resetAt: info.resetAt,
  };
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
  return '127.0.0.1'; // Fallback
}
