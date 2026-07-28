# PropMatch AI — Backend Context Handoff (for Ali)

Hand this to a fresh session. It captures everything needed to continue.

## Who / what

- **PropMatch AI** — broker-free rental marketplace, Egypt (Mansoura). ITI 3-week
  capstone, 5-person team (Mohamed, Samer, Mostafa, **Ali = you**, Abdelhamid).
- **You are Ali.** Your sprint tasks:
  - Week 1: **WebSockets / Real-Time Engine** ✅ done + merged to dev.
  - Week 2: **Hybrid Matchmaker & Offer Logic** ✅ done + merged to dev.
  - Week 3: **Freemium Enforcement & Quota Limits** ✅ built + tested, **UNCOMMITTED**.
- Two repos, siblings under `C:\Users\TUF\OneDrive\Desktop\PropMatch Ai\`:
  - `propmatch_backend` — **NestJS 11 + Prisma 7 + Postgres** (the active repo).
  - `propmatch_frontend` — Next.js 16 (Claude built most of it; it's the contract
    source of truth the backend must match).

## Working agreement (IMPORTANT)

- **Never add Claude as co-author/contributor.** No `Co-Authored-By` trailer on
  any PropMatch commit. (Saved in memory.)
- **Ali pushes branches himself.** Create/commit locally only; do not `git push`
  unless Ali explicitly says so. He rejected a push before.
- Match the frontend contracts exactly (`propmatch_frontend/src/lib/api/contracts/*`
  and `src/mocks/router.ts`).

## ⏭️ IMMEDIATE NEXT TASK — "Option B" reconciliation, then commit

Ali approved **Option B**. Current state: local branch `dev` is at `6a86eb2`,
**167 commits behind `origin/dev` (979c86f)**; the fast-forward is blocked by
uncommitted Week-3 work. Do this:

1. `git stash push -u -m "ali: week3 quota + seed + fixes"` (stashes tracked +
   untracked; **note** `prisma/seed.ts` is untracked → recover later from
   `stash@{0}^3`).
2. `git merge --ff-only origin/dev` (get the 167 commits).
3. `npm install` → `npx prisma generate` → `npm run build` (confirm the fresh
   dev builds; Prisma 7 client MUST be regenerated after a pull or you get
   phantom enum errors).
4. **Re-apply the Week-3 work** onto the new base (see "uncommitted changes"
   below). Recover the seed: `git checkout "stash@{0}^3" -- prisma/seed.ts`.
   The env/tooling bits (`.env` in envFilePath, `seed` script, `tsx` devDep) and
   the `src/quota/` module re-apply cleanly; the **risk** is
   `properties.service.ts` (getAll) and `properties.controller.ts` (optimizer
   endpoint) — those 167 commits may have changed the optimizer endpoint, so
   re-verify the quota gate still slots in **before** the SSE stream opens.
5. Re-run the full end-to-end test (see "How to test").
6. Commit locally (no co-author trailer). **Do not push** — Ali pushes.

## The uncommitted Week-3 changes to re-apply (verified working last session)

- **NEW `src/quota/`** (freemium enforcement, PRO-18):
  - `quota.service.ts` — `consumeOptimizer(userId)` checks + decrements
    `optimizerUsesLeft`, throws coded 403
    `{ code:'QUOTA_EXHAUSTED', trigger:'payment', paymentType:'REFILL_MATCHES', priceEgp:30 }`
    when 0. `getQuota(userId)` returns quota or `null` (tenants have no row).
    `@Global`, exports `QuotaService`.
  - `quota.controller.ts` — `GET /api/quota` (JwtAuthGuard), returns the authed
    user's quota / null.
  - `quota.module.ts`.
- **`app.module.ts`** — register `QuotaModule`; `envFilePath: ['.env.development',
  '.env.production', '.env']` (single `.env` works for the whole team).
- **`properties.controller.ts`** — inject `QuotaService`, add `@Request() req`,
  call `await this.quotaService.consumeOptimizer(req.user.userId)` at the TOP of
  `optimizeDescriptionStream` (before `res.setHeader` — a quota block must be a
  JSON 403, impossible once SSE is committed). Endpoint:
  `POST /api/landlord/properties/draft/optimize-description/stream`.
  NOTE: `@Res() res` must stay UNtyped (typing it needs `import type` under
  isolatedModules — TS1272).
- **`properties.service.ts`** — merge-regression fix in `getAll`: add
  `orderBy: [{ isBoosted: 'desc' }, { createdAt: 'desc' }]` (PRO-14 boosted-first),
  change `bedrooms` to `{ gte }` (frontend sends "N+" = minimum), broaden `q` to
  a multi-field `OR` (title/description/district/propertyAroundServices). Removed
  the dead `search()` method + `SearchPropertiesDto` import + the orphaned
  `src/properties/dto/search-properties.dto.ts`. **Re-check these against the new
  dev's getAll — a teammate may have changed it again.**
- **`prisma/seed.ts`** (257 lines) — comprehensive test seed (see below).
- **`package.json`** — `"seed": "tsx prisma/seed.ts"` script + `tsx` devDep.

Offer quota (`freeOffersLeft`) and listing quota (`freeListingsLeft`) were
already enforced inline in their own services (Week 2 / teammates) — only the
optimizer quota + the `GET /quota` endpoint were missing.

## What's already DONE and on dev (don't rebuild)

- **Week 1 realtime** (`src/realtime/`): Socket.io gateway, cookie-JWT handshake
  auth, `user:<id>` + `admins` rooms, events `notification` + `admin:queue:item`.
  `RealtimeService` is the typed API teammates inject (`propertySubmitted`,
  `notifyUser`, etc.). 7-test spec passes. Dev added a `message` event for
  messaging.
- **Week 2**: hybrid search (`GET /properties`), matchmaker + offers now live in
  `src/offers/` (dev extended it into the full flow incl. tenant inbox
  view/accept/reject + PII reveal + `src/offers/match-score.util.ts` — the score
  ported verbatim from the frontend mock, clamped 5–98).

## Environment / gotchas (these WILL bite)

- **Ports**: backend `:3001`, REST under **`/api`** global prefix, Socket.io at
  **root** (`/socket.io`). Frontend `:3000`. Frontend env:
  `NESTJS_API_URL=http://localhost:3001/api` (WITH /api),
  `NEXT_PUBLIC_SOCKET_URL=http://localhost:3001` (NO /api),
  `API_MOCKING=disabled`.
- **`.env`** (gitignored) already has `PORT=3001`, `JWT_SECRET=dev_jwt_secret_change_me`,
  `DATABASE_URL="prisma+postgres://localhost:51213/?api_key=..."`. If missing,
  extract from `npx prisma dev ls`.
- **The DB keeps stopping.** `npx prisma dev` (Prisma-managed local Postgres on
  51213) dies between sessions / on sleep. Restart with
  `npx prisma dev start default`, wait ~3s, then work. `ECONNREFUSED` from Prisma
  = the DB is down, NOT a code bug.
- **After ANY schema change or fresh clone: `npx prisma generate`.** The
  generated client at `generated/prisma/` is stale otherwise → phantom enum type
  errors (this is what looked like "Samer's bugs" — it was a stale client).
- **The seed uses `tsx`, not ts-node.** `ts-node` can't resolve the Prisma-7
  client's `.js` import specifiers. `npm run seed` uses `tsx`.
- **`nest build` excludes spec files**, so a broken `.spec.ts` fails
  `tsc --noEmit`/jest but NOT `npm run build`.

## Seed (comprehensive test world) — `npm run seed`

Everyone's password: **`Password123!`**. ⚠️ Destructive (wipes tables).
- `admin@propmatch.local` (ADMIN), `landlord@propmatch.local` (LANDLORD,
  verified, quota listings3/optimizer5/offers5, 2 approved + 1 pending property),
  `landlord.pending@propmatch.local` (pending eKYC → gate test),
  `tenant@propmatch.local` (verified, 2 approved + 1 pending request),
  `tenant.new@propmatch.local` (no eKYC → gate test).
- Stable ids: approved property `20000000-0000-4000-8000-000000000001`; open
  request (no offer) `30000000-0000-4000-8000-000000000001`; already-offered
  request `...002`.

## How to test (all green last session)

```
npx prisma dev start default      # DB up
npm run seed                      # clean world
npm run start                     # wait for "successfully started"
```
Then over HTTP (base `http://localhost:3001/api`), login (`POST /auth/login`
{email,password} — capture `accessToken` OR `accesstoken`, see typo below):
- `GET /properties` (+ filters) → boosted villa first, no PII.
- `GET /landlord/requests` (landlord Bearer) → scored, alreadyOffered.
- `GET /quota` (Bearer) → {listings,optimizer,offers}; tenant → null.
- `POST /landlord/offers` → decrements offers; duplicate → 409.
- Optimizer: `POST /landlord/properties/draft/optimize-description/stream` —
  drain optimizerUsesLeft (LLM throws fast without SBG_API_KEY, but the quota
  still decrements) → next call returns **403 QUOTA_EXHAUSTED / REFILL_MATCHES / 30**.

## Open CROSS-TEAM issues (not Ali's, but they block full integration)

1. **Register 400 (role case).** Frontend sends `role:"tenant"` (lowercase);
   backend `SignupDto` `@IsIn(['TENANT','LANDLORD'])` (uppercase) → 400. Needs a
   case-mapping at the auth boundary (Mohamed). The **seed sidesteps it** — seeded
   users log in fine.
2. **Login token typo.** `auth.service.signIn` returns `accesstoken` (lowercase t);
   `signup` returns `accessToken`. Frontend reads `accessToken` → login token is
   undefined. Handle both when capturing (`accessToken || accesstoken`).
3. **Samer's `verification.controller.spec.ts:48`** — a loosely-typed mock request
   (`request.headers.authorization` on `{}`). Only real remaining tsc/jest error;
   `nest build` passes without it.
4. **Backend has no CI** — broken commits have landed (would be caught by
   typecheck/lint/tests + `prisma generate` in CI).
5. `GET /properties/:id` PII gate — a per-viewer `contactUnlocked` (owner/admin or
   ACCEPTED offer / CONNECTED match) should gate contact on the detail endpoint;
   verify dev's version does this now (the accept flow exists).

## Frontend note

Frontend is on branch `ali-dev` (its own repo), with a full mock backend that now
tolerates a leading `/api` so one `NESTJS_API_URL` works for mock + real backend.
Frontend has CI. Not the focus now, but it's the contract reference.
