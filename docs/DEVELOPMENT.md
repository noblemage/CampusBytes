# Development & Deployment

A quick cheat sheet on how to work with this locally and get it live.

## Local Dev

### Database helpers

We use SQLite locally. Here are the commands you'll use most:

- **Reset and seed**: Run `npx prisma db seed`. This wipes the database entirely and sets up the default demo accounts (`10001`, `10002`, `10003`, and `warden_demo`).
- **View data**: Run `npx prisma studio` to open a GUI in your browser so you can view or edit rows manually.
- **Sync schema changes**: If you edit `prisma/schema.prisma`, sync it to your local database file by running:
  ```bash
  npx prisma db push
  ```

### Passkey (WebAuthn) testing gotchas

Passkeys (FaceID/Fingerprint) require a secure context. 

- If you're on your computer using `localhost:3000`, it works fine because browsers treat localhost as secure.
- If you're trying to test it on a phone over your local Wi-Fi (like `192.168.x.x:3000`), the browser will block WebAuthn because it's not HTTPS. To test passkeys on a physical phone, you'll need to tunnel the connection using something like `ngrok` or `zrok` to get a temporary HTTPS URL.

---

## Production Deployment

### 1. Database
SQLite is file-based and won't hold up in production. Swap to PostgreSQL (Supabase, Neon, etc. work out of the box).

1. Update the database URL in your production environment to point to your Postgres instance.
2. Push the schema to the database:
   ```bash
   npx prisma db push
   ```

### 2. Rate limiting
Rate limiting is handled by Upstash Redis.
1. Spin up a free Redis database on Upstash.
2. Copy the REST URL and REST Token.
3. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in your environment.

### 3. Checklist of variables to set

- `DATABASE_URL` — connection string for your production Postgres.
- `JWT_SECRET` — a long random string to sign sessions. If this leaks, anyone can forge sessions.
- `QR_SECRET` — a long random string to sign QR hashes. If this leaks, anyone can forge passes.
- `TIMEZONE` — e.g. `Asia/Kolkata`. Sets when the daily QR passes expire and when the menu resets. Defaults to `Asia/Kolkata`.
- `NEXT_PUBLIC_ENABLE_DEMO_MODE` — **set to `false`** so the demo card and bypass logins don't show up in production.

---

## Architecture & Optimizations

This project is built to run entirely on free-tier infrastructure (Vercel, Supabase, Upstash) while handling massive burst traffic (e.g. 10,000 students all opening the app at lunch).

Here is how the architecture handles scaling:
1. **O(1) Verification**: The QR pass payload is `studentId:hash`. The Warden scanner reads the student ID and performs an O(1) database lookup instead of scanning the entire database to match the hash.
2. **Bandwidth Trimming**: We use Prisma's `_count` aggregate for Passkeys and strict `select` fields so heavy JSON payloads aren't sent from Supabase to Vercel.
3. **Multi-layer Caching**: 
   - The daily menu is cached in Upstash Redis for 24 hours (1 Postgres query per day).
   - Warden dashboard metrics are cached in Redis for 60 seconds.
   - We use HTTP `Cache-Control` headers so Vercel's Edge network returns fresh data instantly.
6. **Server-Sent Events (SSE)**:
   - Vendor live orders are pushed over a continuous `EventSource` connection rather than aggressive interval polling. This drops server CPU utilization by virtually eliminating TCP handshakes and excessive DB queries.
7. **Lazy Loading Heavy Dependencies**:
   - Libraries like `qrcode` are dynamically imported (`await import('qrcode')`) only when a user triggers the specific UI state that requires them, keeping the initial JavaScript payload extremely lean.
8. **Atomic Check-Ins (Kiosk Mode)**:
   - When running in Warden Kiosk mode, the verification and check-in steps are merged into a single atomic API call, entirely bypassing the network tunnel "double-request" latency.
9. **Web Audio API**:
   - Kiosk feedback tones are synthesized on the fly using the browser's native Web Audio API, avoiding heavy MP3 file downloads or caching issues over slow Wi-Fi.
10. **Native Dynamic Icons**:
    - Instead of static SVGs which are known to break in Apple Safari/iOS, we use Next.js `apple-icon.tsx` to dynamically generate perfect `png` icons using Twemoji edge-rendering.
11. **Time-Drift Compensation**:
    - Since TOTP calculations depend on exact sync, the client checks the server's time on load and offsets its local generation clock accordingly. If a student's system clock is off, pass generation still works perfectly.
12. **Screen Wake Lock**:
    - Uses the browser's native Screen Wake Lock API when a QR pass modal is expanded. This keeps the device's screen bright and awake so scanners can read the code instantly in low-signal lines.

