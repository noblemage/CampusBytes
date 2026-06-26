# CampusBytes

My hostel was still using pen and paper to track mess check-ins. It was slow, annoying, and prone to cheating. So I built this to replace it.

Students pull up a QR code on their phone, the warden scans it, and boom—check-in done. 

## What does it actually do?

- Students log in using a password or just a passkey (Face ID, fingerprint, whatever their phone supports). Super fast.
- Every day, they get a fresh, uniquely generated QR pass for breakfast, lunch, and dinner.
- The warden just scans the code. If someone forgets their phone, the warden can look them up manually.
- There's a live dashboard tracking exactly how many meals have been served so far. No more guessing.

## Checking out the demo

If you just want to poke around without setting up a database, the app has a built-in demo mode.

- The login pages have "Quick Fill" buttons so you don't even have to type.
- Try logging in as a paid student (`10001`), an unpaid student (`10002`), or the warden (`warden_demo`).
- We specifically left student `10003` unregistered. Try logging in with `10003` to see the password setup flow. It pretends to register you but doesn't actually touch the database, so the next visitor can try it too.
- Want to host this yourself to show it off? Run `npx prisma db seed`. It wipes the database and sets up these exact demo accounts.

**Want to turn the demo off?** Just remove `NEXT_PUBLIC_ENABLE_DEMO_MODE="true"` from your `.env` file. All the demo helpers disappear and it runs like a real, secure production app.

## Under the hood (Security)

- QR passes are cryptographically signed (HMAC-SHA256) and expire daily. You can't just screenshot your buddy's pass or reuse yesterday's code.
- Passwords are bcrypt-hashed.
- Sessions use secure, http-only JWT cookies. JavaScript can't touch them.
- We drop a rate-limiter (Upstash Redis) on every single API endpoint to block spam at the edge.
- The database literally rejects duplicate entries at the constraint level, so scanning a pass twice physically cannot double-count a meal.

## The Stack

- Next.js 16 (App Router)
- PostgreSQL on Supabase (managed via Prisma)
- SimpleWebAuthn (for those sweet passkeys)
- Upstash Redis
- Tailwind CSS v4

## Running it yourself

1. Install the stuff:
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
   ```

3. Push the schema and spin it up:
   ```bash
   npx prisma db push
   npm run dev
   ```
