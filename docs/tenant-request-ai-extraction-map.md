# Tenant-request AI extraction map

## Scope and non-goals

This note records the existing backend contract before an AI-assisted tenant
request extractor is added. It does not add an endpoint, provider call, schema
change, or matching behavior. AI output must be suggestions only: the tenant
reviews and submits the existing structured create request separately.

## Current persistence model

| Entity | Current fields and relations | Status/lifecycle |
| --- | --- | --- |
| `TenantRequest` | Required tenant FK; `minBudget`, `maxBudget`, `preferredLocations`, `propertyType`, `requiredBedrooms`, `needsFurnished`, `flexibilityScore`, and `lifestyleRequirements`; optional `approvedBy` admin FK; `ownerOffers` relation; timestamps. | `PENDING` by default; Admin changes it to `APPROVED` or `REJECTED`; tenant can set own request to `CLOSED`; accepting an offer changes it to `FULFILLED`. |
| `OwnerOffer` | Required owner and tenant-request FKs; Prisma `propertyId` is nullable, but the current create DTO requires it; `pitchMessage`, `proposedPrice`, status, timestamps. | `SENT` by default, then `VIEWED`, `ACCEPTED`, or `REJECTED`. |
| `MatchConnection` | Required tenant, owner, and property FKs; `matchScore`, `ConnectionStatus`, timestamps, messages. It has no direct tenant-request FK. | Offer acceptance creates a `CONNECTED` connection after claiming the request and accepting the selected offer. |

`Property` has required owner, country, governorate, and city relations, plus
property facts. A sent offer must reference a property owned by the landlord and
the property must be `APPROVED`. `User` has the role enum `TENANT`, `LANDLORD`,
or `ADMIN`, and an optional one-to-one `IdentityVerification`. The verification
must be `APPROVED` wherever `VerifiedGuard` is applied.

## Tenant-request API

The global prefix is `/api`.

| Method and route | Access | Request / response | Ownership and state behavior |
| --- | --- | --- | --- |
| `GET /api/tenant/requests` | JWT + `TENANT`; no `VerifiedGuard`. | `{ items: TenantRequestResponse[] }`. | Returns only `tenantId` equal to the authenticated user. |
| `POST /api/tenant/requests` | JWT + `TENANT` + approved identity verification. | `CreateTenantRequestDto`; returns `TenantRequestResponse`. | `tenantId` comes from JWT, not client input. New row defaults to `PENDING`; no update endpoint exists. |
| `POST /api/tenant/requests/:id/close` | JWT + `TENANT`; no `VerifiedGuard`. | No body; `{ ok: true }`. | Finds by both request ID and JWT tenant ID, then sets `CLOSED`. No DELETE endpoint exists. |

`TenantRequestResponse` contains `id`, `tenantId`, the eight structured
request fields, `status`, `rejectionReason`, `offersCount`, and ISO
`createdAt`. `offersCount` is calculated from `_count.ownerOffers`; it is zero
when the create query has no relation count. `rejectionReason` is always `null`
because it is not in the Prisma `TenantRequest` model.

### Current create DTO

Every field below is required by `CreateTenantRequestDto`; there are no DTO
defaults or optional fields.

| Field | Validation | Classification |
| --- | --- | --- |
| `minBudget` | number, `>= 0` | hard structured; AI may suggest only when explicitly stated |
| `maxBudget` | number, `>= 1` | hard structured; AI may suggest only when explicitly stated |
| `preferredLocations` | string, minimum 2 characters | hard structured; AI may suggest only when explicitly stated |
| `propertyType` | `PropertyType` enum: `APARTMENT`, `VILLA`, `STUDIO` | hard structured; AI may suggest only when explicitly stated |
| `requiredBedrooms` | integer, `>= 0` | hard structured; AI may suggest only when explicitly stated |
| `needsFurnished` | boolean | hard structured; AI may suggest only when explicitly stated |
| `flexibilityScore` | integer, 1–10 | hard structured, but no current free-text equivalent; tenant must select or confirm it |
| `lifestyleRequirements` | string, minimum 10 characters | soft semantic text; preserve tenant wording rather than inventing it |

The service calculates or derives `tenantId` from the authenticated user,
`status` from Prisma’s default, timestamps from Prisma, `offersCount` in the
mapper, and `approvedBy` only during Admin moderation. These must never be
accepted directly from a future extraction client.

### Field classification for a future extractor

| Group | Fields / treatment |
| --- | --- |
| A. Authoritative structured fields | All seven non-text create fields: budgets, preferred locations, property type, bedrooms, furnishing, and flexibility. The confirmed values must pass the existing create DTO unchanged. |
| B. Soft semantic fields | `lifestyleRequirements`: quiet area, transport, family/student suitability, work-from-home needs, and nearby services can remain free text. |
| C. Suggestions requiring confirmation | Any extracted budget, location, type, bedrooms, furnishing preference, and an optional proposed flexibility score. Return absent/unknown rather than a guessed value. |
| D. Never infer or invent | `tenantId`, role, identity-verification status, admin approval, offer/property ownership, property ID, exact unstated dates, budgets, cities, bedrooms, furnishing, or flexibility. Do not convert vague wording into a precise fact without tenant confirmation. |

There are no move-in-date, rental-duration, or multi-location array fields in
the current model. The API uses singular `preferredLocations: string`, despite
its plural name. A future extractor must report missing required fields rather
than fabricate them. The current DTO also does not enforce `minBudget <=
maxBudget`; preserve that as a documented validation gap for a later task, not
a behavior change here.

## Owner-offer API

| Method and route | Access | Request / response | Rules |
| --- | --- | --- | --- |
| `GET /api/landlord/requests` | JWT + `LANDLORD` + approved verification. | `{ items }` of approved tenant requests, match score, already-offered flag, and best matching property. | Only landlord-owned, approved properties participate; tenant identity is omitted. |
| `GET /api/landlord/offers` | JWT + `LANDLORD`; no `VerifiedGuard`. | `{ items }` sent-offer projections. | Own offers only. Tenant name/phone are disclosed only for accepted offers. |
| `POST /api/landlord/offers` | JWT + `LANDLORD` + approved verification. | `{ tenantRequestId, propertyId, pitchMessage, proposedPrice }`; returns `{ id, status, freeOffersLeft }`. | Request must be approved; property must be owned by caller and approved; quota is required; one offer per owner/request is enforced with `ConflictException`. |
| `GET /api/tenant/offers` | JWT + `TENANT`; no `VerifiedGuard`. | `{ items }` received-offer projections. | Offers are selected through caller-owned tenant requests; owner/private address data appear only after acceptance. |
| `POST /api/tenant/offers/:id/view` | JWT + `TENANT`; no `VerifiedGuard`. | Returns received-offer projection. | Caller must own the underlying request; changes only `SENT` to `VIEWED`. |
| `POST /api/tenant/offers/:id/accept` | JWT + `TENANT` + approved verification. | Returns accepted status, owner name/phone, property private address, and match connection ID. | Offer must be `SENT`/`VIEWED`; property and request must still be approved. Transaction fulfills request, accepts this offer, rejects competing open offers, and creates `CONNECTED` match. |
| `POST /api/tenant/offers/:id/reject` | JWT + `TENANT`; no `VerifiedGuard`. | `{ ok: true }`. | Caller must own request; only `SENT`/`VIEWED` may be rejected. |

Admins can inspect pending request queues and use
`POST /api/admin/requests/:requestId/review` to approve/reject a pending
request; `GET /api/admin/requests/:requestId` returns a safe moderation
projection. No dedicated Admin owner-offer moderation endpoint was found.

## Matching interaction and duplication risks

`GET /api/landlord/requests` is the active tenant-request matching path. It
loads approved requests and the landlord’s approved properties, then calls
`scoreRequestAgainstProperty` for every pair. The score is a rule-based,
clamped 5–98 value: budget, district substring, type, bedrooms, furnishing,
lifestyle word overlap, flexibility, and boosting all change the score. They
are scoring signals, not hard exclusions.

`src/offers/match-score.util.ts` explicitly remains a placeholder for future
semantic/embedding work. Existing semantic property search is a separate
property-search path and is not connected to `TenantRequest` or offer scoring.
Extraction must not alter matching, rankings, or confirmed request fields as a
side effect; it should only prepare client-visible suggestions.

Risks to avoid:

- Do not create another TenantRequest, Offer, or Matching module. Reuse
  `TenantRequestsModule` and leave offer acceptance as the sole creator of
  `MatchConnection`.
- Do not duplicate `POST /api/tenant/requests`; its current frontend-contract
  comment refers to `src/lib/api/contracts/tenantRequest.ts`, but that frontend
  file is outside this task’s scope and was not inspected.
- The response mapper exposes a `rejectionReason` that Prisma does not store,
  and stringifies the Prisma enum. Any future contract must document—not hide—
  this drift.
- The Prisma `OwnerOffer.propertyId` is optional while the current create DTO
  and service require/use it. Do not propagate that optionality into extraction.
- No tenant-request or offers module test files were found. Existing relevant
  coverage is indirect (Admin/realtime); later runtime work needs focused tests.

## Sensitive-data boundary

The future provider prompt may contain only tenant-supplied natural-language
request text. It must exclude national ID, identity-document or selfie images,
password hashes, refresh-token hashes, phone number, email, exact private
address, verification status/notes/rejection reasons, owner identity, property
ownership, offer records, and unrelated user profile data. Do not load a User,
IdentityVerification, Property, OwnerOffer, or MatchConnection record merely to
build the extraction prompt.

## Recommended future insertion point

Use **`POST /api/tenant/requests/extract`**, not
`POST /api/tenant-requests/extract`. The existing controller is
`@Controller('tenant/requests')`, so this route preserves the tenant-scoped
contract and avoids a parallel route style.

Add the handler to `TenantRequestsController`, protected by the existing JWT,
`TENANT` role, and `VerifiedGuard` pattern used by create. Add a focused
extraction service inside `tenant-requests`; it should receive only a small
input DTO such as `{ text: string }`, call the provider, validate its output,
and return suggestions plus missing-field names. It must not call Prisma create
or `TenantRequestsService.create`.

Suggested validation/error boundary:

1. Strictly validate the input text length and reject unknown keys through the
   existing global whitelist/forbid-non-whitelisted pipe.
2. Validate provider output with an extraction-specific schema: enum values,
   finite numeric ranges, integer bedrooms, boolean furnishing, and explicit
   `undefined` for unstated facts.
3. Return missing required create fields; require the client to review/edit
   them, then submit the unchanged existing create endpoint.
4. Translate provider timeout/unavailability to a sanitized 503/504-style API
   error; do not leak provider details, prompts, or credentials.

## Flow

```text
Tenant enters natural-language request
        -> authenticated, verified POST /api/tenant/requests/extract
        -> AI returns strictly validated, non-persisted suggestions + missing fields
        -> tenant reviews and edits the structured form
        -> POST /api/tenant/requests saves confirmed CreateTenantRequestDto
        -> request is PENDING for Admin review
        -> approved request is visible to verified landlords for rule-based offers
```

## Unverified assumptions

- The referenced frontend contracts/mocks were not inspected, per task scope;
  their exact field names and route behavior need a later shared-contract check.
- It is not established whether extraction should be allowed before manual
  verification. This note recommends verification to match request creation and
  prevent unverified provider usage, but product may choose otherwise later.
- No intended AI provider, provider schema, rate limit, or cost policy is yet
  specified.
