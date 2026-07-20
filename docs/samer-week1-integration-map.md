# Samer — Week 1, Day 1, Mini Task 1: Integration Map

## Scope and repository baseline

This is an inspection-only map for the current `dev` baseline. Both local repositories were synchronized using the required sequence (`samer-dev` → `dev` fast-forward pull → `samer-dev` merge). Each ended clean, on `samer-dev...origin/samer-dev`, and both `dev` merges were already up to date.

| Repository | Local directory | Inspected branch | Synchronization result |
| --- | --- | --- | --- |
| `Prop-Match/propmatch_backend` | `backend` | `samer-dev` | clean; `origin/dev` fetched; fast-forward pull and merge reported “Already up to date” |
| `Prop-Match/propmatch_frontend` | `frontend` | `samer-dev` | clean; `origin/dev` fetched; fast-forward pull and merge reported “Already up to date” |

No Verification module, controller, service, or DTO exists in the backend at this baseline.

## Automated command results

The baseline environment was subsequently fixed and the required commands were executed successfully. The first backend build and test attempt failed only because a fresh clone did not yet have the generated Prisma client. Running `npx prisma generate` generated it locally under `generated/prisma`; that path is Git-ignored and must not be committed. The subsequent backend build and tests passed.

| Repository | Command / check | Result |
| --- | --- | --- |
| backend | `npm install` | passed |
| backend | `npx prisma generate` | passed; generated local Git-ignored `generated/prisma` |
| backend | `npm run build` | passed after Prisma generation |
| backend | `npm run test -- --runInBand` | passed — 2 test suites, 8 tests, 0 snapshots |
| backend | `npm install` security summary | 3 moderate vulnerabilities; observation only. Do not run or recommend `npm audit fix --force` for this mini task. |
| frontend | `npm install` | passed |
| frontend | `npm run lint` | passed |
| frontend | `npm run test -- --runInBand` | passed — 12 test suites, 85 tests, 0 snapshots |
| frontend | `npm run build` | passed |
| frontend | `npm install` security summary | 2 moderate vulnerabilities |

### Existing baseline warnings — out of scope

These warnings were observed during successful baseline checks. They were not fixed in this documentation-only mini task.

1. Jest did not exit immediately after the frontend tests, suggesting an asynchronous open handle.
2. Next.js detected multiple lockfiles and inferred `D:\nodejs` as the workspace root instead of the frontend directory.
3. npm reported 2 moderate frontend vulnerabilities.

Backend scripts include `build: nest build` and `test: jest`; frontend scripts include `lint: eslint`, `test: jest`, and `build: next build`. Existing backend tests include `src/app.controller.spec.ts` and realtime gateway tests; frontend includes mock/realtime tests, including verification submission coverage in `src/mocks/__tests__/realtime.test.ts`.

## Current frontend contract

The browser eKYC hook uses the same-origin BFF and currently calls:

| Method and path | Request | Response / behavior |
| --- | --- | --- |
| `GET /verification` | Bearer token supplied by BFF | `status`, `uploadedDocuments`, `nationalIdLast4`, `rejectionReason`, `submittedAt`, `reviewedAt`, `canSubmit` |
| `POST /verification/upload` | JSON `{ document: "national_id_front" | "national_id_back" | "selfie", simulateUnreadable?: boolean }` | JSON `{ document, accepted, reason }`; this is simulated rather than a file upload |
| `POST /verification/submit` | JSON `{ nationalId: string }` | `{ ok: true }`; mock creates or resets the one-per-user row to `PENDING` |

`src/lib/api/contracts/verification.ts` contains Zod schemas for all of the above. `nationalId` is constrained to exactly 14 digits. Its UI union contains five states, but only `PENDING`, `APPROVED`, and `REJECTED` are considered persisted; `NOT_SUBMITTED` is absence of a row and `RESUBMISSION_REQUIRED` is currently derived from rejected + reason.

`KycWizard` has approved, pending, initial, rejected/resubmission, document-uploading, captured, bad-quality, and disabled submission states. `UploadTile` is a reusable presentational component with `empty`, `uploading`, `captured`, `bad-quality`, and `locked` visual states. Both should be reused for Day 3 rather than reimplemented. The shared `/verify` page is role-neutral; `/landlord/verify` is an additional landlord-shell entry.

## Proposed backend contract (target, not implemented)

All routes are below the Nest global prefix, so the target routes are:

| Method and path | Authentication | Proposed request | Proposed safe user response |
| --- | --- | --- | --- |
| `GET /api/verification/me` | `JwtAuthGuard`; derive `userId` from `req.user` | none | `{ status, rejectionReason, submittedAt, reviewedAt, canSubmit }`; do not return National ID, document keys, permanent URLs, or `nationalIdLast4` to ordinary users |
| `POST /api/verification/submit` | `JwtAuthGuard`; derive `userId` from `req.user` | `multipart/form-data`: National ID (if retained by product decision), `nationalIdFront`, `nationalIdBack`, `selfie`; each image required | `{ status: "PENDING", submittedAt }` or a similarly minimal safe state response |

This proposal deliberately does not settle whether the National ID text field remains in the public submit contract; the current UI includes it, while the target safe response must not disclose it. Files must be stored as private object keys, not permanent public URLs. OCR is optional, review is manual Admin review, and identity images/data must never be sent to OpenAI or ChromaDB.

## Backend integration points

### Authentication, prefix, validation, and localization

`main.ts` sets global prefix `api`, installs `I18nValidationPipe` with `whitelist`, `forbidNonWhitelisted`, and `transform`, and installs `CustomI18nValidationExceptionFilter`. `AppModule` configures Arabic as the fallback i18n language and uses the `Accept-Language` resolver.

`JwtAuthGuard` delegates to Passport’s `jwt` strategy. `JwtStrategy` extracts a Bearer token, validates `{ sub, email, role }`, and attaches `{ userId: payload.sub, email: payload.email, role: payload.role }` to `req.user`. A future verification controller should use this trusted `req.user.userId`, never a user ID supplied by the client.

`UsersService.findById` and `findByEmail` already include `identityVerification`, so they are useful read-side integration points. `IdentityVerification` is already one-to-one through `userId @unique`, but it stores `nationalId` and `nationalIdFrontUrl`, `nationalIdBackUrl`, and `selfieUrl` as permanent-URL-shaped fields. Its persisted enum currently lacks `RESUBMISSION_REQUIRED`; absence represents no verification record.

The reusable realtime method is `RealtimeService.kycSubmitted(...)`, which emits an ephemeral admin queue item of type `kyc` through the global `RealtimeModule`. It should be called after a successful submit transaction. `notifyUser(...)` persists a normal user notification and is not the verification-submission queue method.

Shared files requiring coordination: `src/main.ts`, `src/app.module.ts`, all `src/auth/**` (especially the global `AuthModule`, JWT strategy, guard, roles decorator/guard, and localized validation filter), `prisma/schema.prisma`, and the realtime contract/gateway/service. Do not rename `LANDLORD` in this task: the current Prisma `UserRole` is `TENANT | LANDLORD | ADMIN`; product wording says `OWNER`.

Old Prisma assumptions that must stay untouched in Mini Task 1 include existing roles, `UserQuota`, payment, property, review, contract, notification, and relationship entities, plus the current identity URL fields and three-value verification enum.

## BFF forwarding flow

`browserClient.ts` only calls `/api/backend/<path>` and serializes every body as JSON with `Content-Type: application/json`. The Next.js catch-all BFF reads request bodies with `request.json()` and passes object bodies to `backendFetch`, which also JSON-stringifies them and sets JSON content type. It retrieves the httpOnly access-token cookie and adds `Authorization: Bearer <token>` upstream. Thus browser JavaScript never sees the token.

This is incompatible with FormData at both layers: `request.json()` consumes/parses JSON rather than preserving a multipart body, and both clients forcibly stringify/set JSON. The BFF will need an explicit multipart forwarding path that preserves form data and its browser-generated multipart boundary. The current BFF must continue handling JSON and SSE behavior separately.

## Mock-only assumptions to remove later

- Uploads do not contain files; `POST /verification/upload` only accepts a document label and can simulate an unreadable image.
- Submission seeds fixed public `https://cdn.example.com/...` document URLs.
- The mock stores raw National ID in memory and returns a last-four value to the ordinary user state.
- `RESUBMISSION_REQUIRED` is derived from `REJECTED` plus `rejectionReason`, rather than persisted.
- Mock JWT-shaped tokens are unsigned development tokens and mock authorization uses the token subject.
- Admin KYC detail is mock-only and uses document URLs; production needs private storage and appropriately authorized access.

## Conflict table

### Conflict: verification endpoint topology
**Existing behavior:** `GET /verification`, `POST /verification/upload`, and `POST /verification/submit`.

**New required behavior:** `GET /api/verification/me` and one multipart `POST /api/verification/submit`.

**Files affected:** frontend verification contract/hook/wizard, BFF route/client, mock router/tests; future backend controller/service/DTO.

**Impact if changed:** existing UI and tests will call obsolete paths until migrated together.

**Recommended options:** version or migrate the frontend and BFF atomically after the backend contract is available; do not retain simulated upload as a production endpoint without an explicit compatibility decision.

### Conflict: National ID validation and exposure
**Existing behavior:** frontend requires a 14-digit `nationalId` and exposes `nationalIdLast4` in the user state.

**New required behavior:** ordinary-user safe responses must not expose National ID data.

**Files affected:** verification Zod schema, KycWizard, formatting utility/tests, mock router/db, future DTO/response mapper.

**Impact if changed:** changing request validation or removing the last-four display is a product/API behavior change.

**Recommended options:** product/security owner decides whether National ID remains a multipart field; define a response schema that omits it and coordinate the UI change.

### Conflict: document storage representation
**Existing behavior:** Prisma and mocks use permanent URL fields.

**New required behavior:** private object keys, with no permanent public identity URLs.

**Files affected:** `prisma/schema.prisma`, migration, verification storage/service and admin document access; mock data/admin UI.

**Impact if changed:** schema/data migration and all document consumers are affected.

**Recommended options:** plan a dedicated schema/storage migration and controlled signed-access design; do not alter Prisma in this mini task.

### Conflict: resubmission status persistence
**Existing behavior:** frontend derives `RESUBMISSION_REQUIRED`; Prisma persists only `PENDING`, `APPROVED`, `REJECTED`.

**New required behavior:** target database enum persists `RESUBMISSION_REQUIRED`; no record remains `NOT_SUBMITTED`.

**Files affected:** Prisma enum/migration, server state transitions, frontend Zod schemas, mocks, admin queues/tests.

**Impact if changed:** existing state derivation and filters change.

**Recommended options:** decide and document migration semantics before implementation; preserve no-record as `NOT_SUBMITTED`.

### Conflict: BFF cannot forward multipart
**Existing behavior:** BFF/client use `request.json()` and JSON stringification.

**New required behavior:** submit must forward multipart form data and images.

**Files affected:** `browserClient.ts`, `client.ts`, `app/api/backend/[...path]/route.ts`, verification hook/tests.

**Impact if changed:** an incorrect boundary/content-type implementation breaks or corrupts uploads.

**Recommended options:** add a dedicated FormData-capable BFF/client path that passes the form data through without setting `Content-Type` manually; retain JSON path for all other endpoints.

### Conflict: role terminology
**Existing behavior:** backend enum and frontend mocks use `LANDLORD`/`landlord`.

**New required behavior:** MVP terminology is `OWNER`.

**Files affected:** Prisma, auth claims, authorization, frontend role contracts/routes/mocks.

**Impact if changed:** a rename is cross-repository authentication and data migration work.

**Recommended options:** keep `LANDLORD` untouched for Mini Task 1; schedule a separately approved terminology migration or explicit mapping.

## Recommended Day 1 file boundaries

### Mini Task 2 — Update Verification Data Model

Confine work to verification-related Prisma schema changes, a focused migration, locally generated Prisma types, and schema/database tests where practical.

Expected boundaries may include:

- `prisma/schema.prisma`
- `prisma/migrations/<verification-migration>/`
- focused verification schema tests

Required constraints:

- Add `RESUBMISSION_REQUIRED` to the persisted verification status.
- Keep `NOT_SUBMITTED` represented by absence of a record.
- Preserve one verification record per user.
- Replace permanent public URL fields with private object-key fields.
- Do not modify User roles, Property, quotas, payments, offers, or shared authentication.
- Do not create `VerificationModule` during Mini Task 2.

### Mini Task 3 — Verification Module Skeleton and API Contract

Confine work to:

- `src/verification/verification.module.ts`
- `src/verification/verification.controller.ts`
- `src/verification/verification.service.ts`
- `src/verification/dto/`
- `src/verification/mappers/`
- `src/verification/verification.service.spec.ts`
- minimal `src/app.module.ts` registration

Reuse:

- `JwtAuthGuard`
- `req.user.userId`
- `PrismaService`
- existing Arabic i18n validation behavior

Target routes:

- `GET /api/verification/me`
- `POST /api/verification/submit`

Upload implementation may remain stubbed until Day 2.

Do not modify shared JWT/signup behavior, introduce owner-only guards, implement storage, or add Admin review endpoints.

Frontend verification contract and BFF multipart migration belong to Day 3, not Day 1.

## Runtime-change confirmation

No frontend files and no runtime backend files were edited. No migration, verification module, upload/storage handling, OpenAI/Chroma integration, auth change, role rename, commit, or push was made. This document is the only intended repository change.
