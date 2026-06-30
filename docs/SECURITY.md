# Security

If you find something that looks like a vulnerability, don't open a public issue. Just reach out to the maintainer directly and explain what you found. That's all we ask.

## How the passes work

Each QR pass is a server-generated HMAC-SHA256 hash. The input is `studentId + date + mealSlot`, signed with `QR_SECRET` which never leaves the server.

So you can't screenshot someone else's pass and use it — it's tied to their ID. You can't reuse yesterday's code — the date is in the hash. You can't use a breakfast pass at dinner — the slot is baked in too. Without the secret, there's no way to generate a valid hash.

The QR image itself is rendered client-side from the hash. The server only ever deals with the hash string.

## Double check-ins

The database has a unique constraint on `(studentId, date, mealSlot)`. The app can't accidentally check someone in twice because the database will physically reject the second insert, not just the application layer. Two simultaneous scans of the same code — only one goes through.

## Sessions

JWTs, signed with HS256, stored in HTTP-only cookies with `SameSite: strict`. 24 hour expiry. Students and wardens have separate cookies — a student session can't touch warden routes.

In production, the `secure` flag is on so the cookie never goes over plain HTTP.

## Passwords and passkeys

Passwords are bcrypt-hashed. Never stored in plain text.

Passkeys are handled by `@simplewebauthn`. If a student registers their device, they can skip the password entirely on return visits. Passkeys need HTTPS — the UI tells you if you're on a connection that can't support it.

## Rate limiting

Every modifying API endpoint is rate-limited by IP using Upstash Redis with a sliding window. The student polling endpoint (`GET /api/students`) specifically bypasses IP rate-limiting to prevent locking out entire campuses sharing a single NAT public IP address during heavy traffic. If Upstash goes down, the limiter fails open — requests go through unchecked rather than locking everyone out. It's a tradeoff we're okay with.

## What to keep secret

- `JWT_SECRET` — signs sessions. If this leaks, anyone can forge a valid session for any user.
- `QR_SECRET` — signs QR hashes. If this leaks, anyone can generate valid meal passes.
- `DATABASE_URL` — direct database access.
- `UPSTASH_REDIS_REST_TOKEN` — access to the rate limit store.

## Honest limitations

No way to revoke a pass mid-day without rotating `QR_SECRET`, which would break all active passes for everyone. For the use case, this is fine.

Date cutovers respect the `TIMEZONE` environment variable (defaults to `Asia/Kolkata`). This ensures breakfast/lunch passes rollover accurately based on local campus time, rather than jumping ahead due to UTC offsets.

If you're running demo mode (`NEXT_PUBLIC_ENABLE_DEMO_MODE=true`), the demo accounts use a published password. That's intentional for the demo, but don't leave it on in a real deployment.
