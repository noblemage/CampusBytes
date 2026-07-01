# CampusBytes

Campus infrastructure usually relies on paper logs and disjointed systems. It is slow and prone to errors. This is a unified webapp to replace it.

Students use a single portal to access daily rolling QR passes for the hostel mess and place live orders with campus vendors.

## What it does

- **Unified Access:** Students log in using a password or WebAuthn passkey (FaceID/Fingerprint).
- **Mess Operations:** Students receive dynamic, rolling QR passes that rotate every 30 seconds via client-side TOTP. Wardens use a high-speed kiosk scanner with instant visual and audio feedback.
- **Vendor Ordering:** Students place live orders with campus vendors. Orders are tracked via Server-Sent Events (SSE) for instant status updates without polling overhead.
- **Administration:** Vendors manage menus and live orders. Wardens track live mess check-ins and metrics.
- **Fail-safes:** Manual lookup fallbacks for students without devices. Screen Wake Lock keeps student devices bright while waiting in queue.

## Demo

A built-in demo mode is available without setting up a database.

- Login pages feature "Quick Fill" for instant access.
- Test roles: paid student (`10001`), unpaid student (`10002`), or warden/vendor (`warden_demo`).
- Run `npx prisma db seed` to wipe the database and provision these exact demo accounts.
 
Disable demo mode by removing `NEXT_PUBLIC_ENABLE_DEMO_MODE="true"` from `.env`.

## Architecture & Security

- **Dynamic Rolling Passes:** QR payloads contain a 30-second rotating TOTP token. Screenshots expire in half a minute, preventing pass sharing. Burn-on-scan prevents replay attacks.
- **Sessions:** Secure, HTTP-only JWT cookies with strict SameSite policies.
- **Validation & Rate Limiting:** Every mutating endpoint is protected by strict Zod schema validation and Upstash Redis rate-limiting to prevent spam.
- **Data Integrity:** Database constraints prevent duplicate check-ins.
- **High Performance:** O(1) scanner verification, Prisma compound indexes (`vendorId, status`), and Server-Sent Events (SSE) for zero-latency live updates without database table scans.

## The Stack

- Next.js 16 (App Router)
- PostgreSQL (Supabase / Prisma)
- SimpleWebAuthn
- Upstash Redis
- Tailwind CSS v4

## Deployment

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure `.env`:
   ```
   DATABASE_URL=
   JWT_SECRET=
   QR_SECRET=
   UPSTASH_REDIS_REST_URL=
   UPSTASH_REDIS_REST_TOKEN=
   TIMEZONE=Asia/Kolkata
   ```

3. Push the schema and start:
   ```bash
   npx prisma db push
   npm run dev
   ```
