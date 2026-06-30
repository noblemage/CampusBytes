# CampusBytes

Hostels are still using printed paper to track mess check-ins. It is slow, annoying, and prone to cheating. So here is a webapp to replace it.

Students pull up a QR code on their phone, the warden scans it, and boom, checkin done. 

## What does it actually do?

- Students log in using a password or just a passkey (can be FaceID or Fingerprint, whatever their phone supports). Super quick.
- Every day, they get a fresh, uniquely generated QR pass for breakfast, lunch, and dinner.
- Warden Kiosk Mode: It provides a full-screen, high-speed camera scanner with instant green/red visual and Web Audio API feedback, automating the entire queue.
- If someone forgets their phone, the warden can look them up manually via the dashboard.
- There's a live dashboard tracking exactly how many meals have been served so far.

## Checking out the demo

If you just want to poke around without setting up a database, the app has a built-in demo mode.

- The login pages have "Quick Fill" buttons so you don't even have to type.
- Try logging in as a paid student (`10001`), an unpaid student (`10002`), or the warden (`warden_demo`).
- We specifically left student `10003` unregistered. Try logging in with `10003` to see the password setup flow. It pretends to register you but doesn't actually touch the database, so the next visitor can try it too.
- Want to host this yourself to show it off? Run `npx prisma db seed`. It wipes the database and sets up these exact demo accounts.
 
**Want to turn the demo off?** Just remove `NEXT_PUBLIC_ENABLE_DEMO_MODE="true"` from your `.env` file.

## Under the hood (Security)

- QR passes are cryptographically signed (HMAC-SHA256) and expire daily. You can't just screenshot a friends pass or reuse yesterday's code.
- Passwords are bcrypt-hashed.
- Sessions use secure, http-only JWT cookies.
- We use a rate-limiter (Upstash Redis) on every mutating API endpoint to block spam, while read-only polling endpoints are intentionally unrestricted for scale.
- The database rejects duplicate entries at the constraint level, so scanning a pass twice physically cannot double-count a meal.
- **Built for Scale:** Includes O(1) scanner verification, Prisma `_count` bandwidth trimming, and Upstash Redis caching for menus and warden metrics so it comfortably runs on free-tier infrastructure.
- **Atomic Check-Ins:** The Kiosk Mode executes verification and redemption in a single, atomic database transaction to eliminate network tunnel latency, processing students in under 150ms.

## The Stack

- Next.js 16
- PostgreSQL on Supabase
- SimpleWebAuthn
- Upstash Redis
- Tailwind CSS v4

## Running it yourself

1. Installing the stuff:
   ```bash
   npm install
   ```

2. Make a `.env` file and throw these in:
   ```
   DATABASE_URL=
   JWT_SECRET=
   QR_SECRET=
   UPSTASH_REDIS_REST_URL=
   UPSTASH_REDIS_REST_TOKEN=
   TIMEZONE=Asia/Kolkata
   ```

3. Push the schema and spin it up:
   ```bash
   npx prisma db push
   npm run dev
   ```
