# Smart Matching Engine — Technical Architecture & Implementation Report

**Status:** Implemented (branch `feature/abdelhamid-tasks`)
**Stack:** NestJS · BullMQ · Redis · PostgreSQL (Prisma) · Socket.io
**Audience:** PropMatch AI engineering team

---

## 1. System Overview

### What we built

The Smart Matching Engine ("Smart Matchmaker") is an asynchronous, queue-based pipeline that scores every `TenantRequest` against the marketplace's approved `Property` inventory using a **hybrid score** — a weighted blend of a deterministic rule-based scorer and semantic (embedding) similarity — and proactively notifies landlords in real time when one of their properties clears a match threshold.

### Why we moved to an asynchronous architecture

The matching logic previously lived (and, for a landlord manually browsing requests, still lives) on the synchronous request path. Two things made that unsustainable for the proactive-notification use case:

- **Embedding calls are slow and external.** Generating a vector via Cohere (or the local sentence-transformers fallback) is a network round-trip in the hundreds-of-milliseconds range. Doing this inline, once per tenant-request approval, against every candidate property, would block the Node.js event loop and directly degrade API latency for unrelated requests.
- **ChromaDB was never meant to be queried per candidate.** A naive "notify all matching landlords" implementation would either query the vector store once per property (N round-trips) or accept an unbounded, unpredictable moderation-approval response time.

The fix: never compute semantic similarity synchronously for a fan-out operation. Instead:

1. Embed the tenant request **exactly once**, in the background.
2. Persist that vector (and the same for every approved property, at approval time).
3. Score every candidate with **local, in-memory cosine similarity** against the persisted vectors — pure arithmetic, no network I/O, no ChromaDB round-trip per candidate.

### The problem it solves

- **Instant API response.** Approving a tenant request returns immediately; scoring and notification happen off the request thread.
- **No event-loop blocking.** Embedding and scoring work is isolated in a BullMQ worker process, decoupled from the HTTP request/response cycle.
- **Score consistency.** The same hybrid formula, fed by the same persisted vectors, is used by both the background worker (for notifications) and the synchronous landlord/tenant browse endpoints (for the UI) — eliminating drift between what a landlord is notified of and what they see on screen.
- **Graceful degradation.** If the embedding provider (Cohere, with a local sentence-transformers fallback) is unavailable, the pipeline degrades to rule-based-only scoring rather than failing the job.

---

## 2. Architecture & Data Flow

The full lifecycle of a match, from tenant submission to landlord notification:

```
┌──────────────┐   1. POST /tenant/requests        ┌──────────────┐
│   Tenant      │ ─────────────────────────────────▶│  TenantReq-   │
│   (client)    │                                    │  uestsService │
└──────────────┘                                    └──────┬───────┘
                                                             │ 2. INSERT (status: PENDING)
                                                             ▼
                                                     ┌───────────────┐
                                                     │  PostgreSQL   │
                                                     │  tenant_request│
                                                     └───────┬───────┘
                                                             │
                              ── nothing enqueued yet — a PENDING request is unvetted ──
                                                             │
┌──────────────┐   3. POST /admin/requests/:id/review       │
│   Admin       │ ────────────────────────────────▶┌────────▼───────┐
│   (moderator) │        { decision: 'approve' }     │  AdminService  │
└──────────────┘                                    │  .reviewRequest│
                                                     └────────┬───────┘
                                            4. UPDATE status=APPROVED
                                                             │
                                            5. queue.add('match-tenant-request',
                                                   { tenantRequestId })
                                                             ▼
                                                     ┌───────────────┐
                                                     │     Redis      │
                                                     │  matching-queue│
                                                     └───────┬───────┘
                                                             │ 6. BullMQ delivers the job
                                                             │    to an available worker
                                                             ▼
                                                     ┌───────────────┐
                                                     │ MatchingWorker │
                                                     │   .process()   │
                                                     └───────┬───────┘
                        7. SELECT tenant_request WHERE id = :id
                        8. Embed request text ONCE (Cohere → local fallback)
                        9. UPDATE tenant_request SET embedding = :vector
                       10. SELECT property WHERE status='APPROVED'
                           AND rent_amount BETWEEN :minBudget AND :maxBudget
                           (SQL pre-filter — also returns each row's
                           cached `embedding` column in the same query)
                       11. For each candidate, in Node memory:
                             ruleScore = scoreRequestAgainstProperty(...)
                             semanticSimilarity = cosineSimilarity(
                               requestVector, property.embedding)
                             finalScore = combineHybridScore(
                               ruleScore, semanticSimilarity)
                                                             │
                       12. Filter candidates: finalScore > 75
                                                             ▼
                                                     ┌───────────────┐
                                                     │  PostgreSQL   │
                                                     │  notification  │◀── 13. createManyAndReturn()
                                                     └───────┬───────┘     (single bulk INSERT)
                                                             │
                       14. For each returned row, emit over the
                           landlord's authenticated socket room
                                                             ▼
                                                     ┌───────────────┐
                                                     │   Socket.io    │
                                                     │    Gateway     │
                                                     └───────┬───────┘
                                                             ▼
                                                     ┌───────────────┐
                                                     │  Landlord      │
                                                     │  (browser)     │
                                                     └───────────────┘
```

**Key property of this flow:** steps 7–14 run entirely inside the BullMQ worker process, off the HTTP request/response cycle that triggered step 5. The admin's `POST /admin/requests/:id/review` call returns as soon as the job is enqueued (a single, fast Redis write) — it does not wait for scoring or notification to complete.

**Trigger timing note:** matching intentionally runs on **admin approval**, not on tenant submission. A `PENDING` request is unvetted; scoring it and notifying landlords before a moderator has reviewed it would waste embedding calls and surface unvetted content.

---

## 3. Queue & Redis Configuration

**Queue registration** (`src/matching/matching.module.ts`):

```typescript
BullModule.registerQueueAsync({
  name: MATCHING_QUEUE, // 'matching-queue'
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => ({
    connection: parseRedisConnection(configService.get<string>('REDIS_URL')),
  }),
});
```

**Connection resolution** (`src/matching/redis-connection.util.ts`): BullMQ's `ConnectionOptions` has no "just give it a URL" shape, so `REDIS_URL` (`redis://[:password@]host:port`) is parsed into the explicit `{ host, port, password }` form BullMQ expects. Missing `REDIS_URL` throws at bootstrap — a deliberate fail-fast choice, so a misconfigured deployment surfaces immediately rather than producing a queue that silently never drains.

| Setting | Value | Source |
|---|---|---|
| Connection | Parsed from `REDIS_URL` env var | `parseRedisConnection()` |
| Local dev Redis | `redis:7-alpine`, mapped to host port `6380` (container port `6379`) | `docker-compose.yml` |
| Job attempts / retries | **BullMQ default (1 attempt, no retry)** | Not overridden |
| Backoff strategy | **Not configured** | No `backoff` option passed to `.add()` |
| `removeOnComplete` / `removeOnFail` | **Not configured** (BullMQ default: jobs persist in Redis until manually cleaned) | No options object passed to `.add()` |
| Job priority | **Not configured** (FIFO within the queue) | — |

**`.add()` call site** (`src/admin/admin.service.ts`, inside `reviewRequest()`):

```typescript
await this.matchingQueue.add(MATCH_TENANT_REQUEST_JOB, {
  tenantRequestId: request.id,
});
```

No job-options object is passed — this is a deliberate MVP starting point, not an oversight, but it is the area most in need of hardening before production scale (see §8, Recommendations).

---

## 4. Worker Setup

**Definition** (`src/matching/matching.worker.ts`):

```typescript
@Processor(MATCHING_QUEUE)
export class MatchingWorker extends WorkerHost {
  async process(job: Job<MatchTenantRequestJobData>): Promise<void> { ... }
}
```

| Aspect | Current configuration |
|---|---|
| Worker count | **1** — a single `MatchingWorker` provider, registered once in `MatchingModule`, running in-process alongside the main NestJS application (not a separate deployable). |
| Concurrency | **1** (BullMQ/`@nestjs/bullmq` default — no `concurrency` option passed to `@Processor()`). Jobs are processed strictly one at a time. |
| Locking | Handled entirely by BullMQ internally. Each job acquires a Redis-backed lock (`lockDuration`, default 30s) for the duration of processing, automatically renewed while the job is active and released on completion/failure. No custom locking logic was written — this is BullMQ's stock at-least-once delivery guarantee. |
| Job routing guard | `if (job.name !== MATCH_TENANT_REQUEST_JOB) return;` — defensive check in case the queue is ever shared with another job type in the future. |

**Note on horizontal scaling:** because concurrency is 1 and there is exactly one worker instance, the matching pipeline currently processes jobs strictly sequentially, one tenant-request approval at a time, across the whole deployment. This is safe and simple at current volume but is the primary scaling lever if approval throughput increases (see §8).

---

## 5. Redis Data Structure

BullMQ stores each job as a Redis hash (plus supporting sorted sets/lists for queue state). A representative job for this queue, as it exists in Redis while queued/active:

```json
{
  "id": "1847",
  "name": "match-tenant-request",
  "data": {
    "tenantRequestId": "8036b318-c63a-4267-b7cf-4bc8c60e1557"
  },
  "opts": {
    "attempts": 1
  },
  "timestamp": 1785521721136,
  "delay": 0,
  "priority": 0,
  "processedOn": 1785521721512,
  "finishedOn": 1785521726489,
  "returnvalue": null,
  "failedReason": null,
  "stacktrace": []
}
```

Field-by-field:

- **`name`** — `"match-tenant-request"` (`MATCH_TENANT_REQUEST_JOB`), the job type the worker's `job.name !== MATCH_TENANT_REQUEST_JOB` guard checks against.
- **`data`** — the payload, deliberately minimal: `{ tenantRequestId: string }`. This is the **only** thing written to Redis for this job. It is a single UUID reference, not a data snapshot.
- **`returnvalue`** — `null` in this pipeline. `process()` returns `Promise<void>`; the worker communicates its results by writing directly to PostgreSQL (the `tenant_request.embedding` column and bulk `notification` inserts) rather than via BullMQ's return-value mechanism. Nothing about scoring results is round-tripped back through Redis.

**Explicit design point — Redis never holds vector data.** The embedding vectors (1024-dimensional Cohere floats, or the local model's dimension) are large enough that storing them in the job payload would bloat Redis memory usage and job-transfer size for no benefit. Instead:

- The job carries only `tenantRequestId` (a 36-byte UUID string).
- The worker **re-fetches the full, current `TenantRequest` row from PostgreSQL** at the start of `process()` — this also protects against acting on stale data if the request changed between enqueue and processing.
- The computed request embedding is persisted to **PostgreSQL** (`tenant_request.embedding`), not passed back through Redis.
- Property embeddings are read directly from **PostgreSQL** (`property.embedding`, populated at property-approval time) in the same SQL query used for the budget pre-filter.

Redis's role is strictly "durable job ticket + delivery," never a data store for domain state.

---

## 6. Database Integration

The worker's PostgreSQL interaction happens in four phases within a single `process()` invocation:

**Phase 1 — Rehydrate the request.**
```sql
SELECT * FROM tenant_request WHERE id = :tenantRequestId;
```
If the row no longer exists (e.g. withdrawn between enqueue and processing), the job logs a warning and exits — not an error, a legitimate race outcome.

**Phase 2 — Generate and persist the request's embedding (once).**
`PropertyEmbeddingService.createPrimaryEmbedding()` is called with a composed query string (property type, preferred locations, bedroom count, furnishing preference, and the tenant's free-text lifestyle requirements). This is Cohere-primary with an automatic local (sentence-transformers) fallback on transient failure. The resulting vector is written back:
```sql
UPDATE tenant_request SET embedding = :vector WHERE id = :tenantRequestId;
```
This single write is what lets every *other* endpoint that needs this request's semantic similarity (the landlord browse/offer endpoints) reuse it without ever calling the embedding provider again.

**Phase 3 — SQL pre-filter candidates.**
```sql
SELECT * FROM property
WHERE status = 'APPROVED'
  AND rent_amount BETWEEN :minBudget AND :maxBudget;
```
This is a hard-rule filter executed entirely in PostgreSQL — it also returns each row's `embedding` column, so no second query is needed to fetch vectors. Location is intentionally **not** filtered in SQL (it's a free-text field on `tenant_request`, not a normalized relation) — that check happens in-memory during scoring, matching the existing rule-based scorer's semantics.

**Phase 4 — Score in memory, then bulk-persist notifications.**
For each candidate, `scoreRequestAgainstProperty()` (rule-based) and `cosineSimilarity()` (semantic, pure JS arithmetic against the two already-fetched vectors) feed `combineHybridScore()`. No further database or network I/O occurs during scoring itself. Candidates clearing the threshold are written in one bulk statement:
```sql
INSERT INTO notification (user_id, type, title, message, link, ...)
VALUES (...), (...), (...) -- one statement, N rows
RETURNING *;
```
via Prisma's `createManyAndReturn()` — a single round-trip regardless of how many landlords qualify, rather than N sequential `INSERT`s.

---

## 7. Notification Trigger

Dispatch is fully decoupled from the HTTP thread that triggered matching — by the time the worker reaches this step, the admin's original `POST /admin/requests/:id/review` request has already completed and returned a response.

**Persist-then-emit pattern** (`RealtimeService.notifyUsers()`, invoked from `MatchingWorker`):

1. **Persist first.** `prisma.notification.createManyAndReturn()` bulk-inserts one row per qualifying landlord. This is the source of truth — a landlord who is offline when the match occurs will still see it via `GET /notifications` on their next visit.
2. **Emit second.** For each returned row, `RealtimeGateway.emitToUser(userId, 'notification', payload)` pushes it over that landlord's authenticated Socket.io room (`user:<id>`), reaching every open tab for a currently-connected landlord in real time.

This ordering is deliberate throughout the codebase (not unique to this feature): if the socket emit fails or the landlord is offline, the database row still exists — the socket is delivery, never the only copy.

**Threshold gate:** only candidates with `finalScore > 75` (`HIGH_MATCH_NOTIFICATION_THRESHOLD`) trigger a notification at all. Sub-threshold matches are still computed and logged (visible to a landlord who browses manually) but do not generate proactive noise.

**Notification content:** each notification carries a hybrid `finalScore`-derived title/message (e.g. *"تطابق قوي (٧٦٪) مع طلب سكن جديد"*) and up to four Arabic match-reason strings (`buildHybridMatchReasons()`), plus a deep link to `/landlord/requests`.

---

## 8. Recommendations / Known Gaps (Pre-Production Hardening)

Documented transparently for the team's roadmap — the current implementation is functionally correct and verified end-to-end, but several production-scale concerns are intentionally deferred:

- **No retry/backoff policy.** A transient failure mid-job (e.g. a momentary Postgres or Redis blip) currently fails the job permanently on the first attempt. Recommend `attempts: 3` with exponential `backoff` on the `.add()` call.
- **No `removeOnComplete`/`removeOnFail`.** Completed and failed jobs accumulate in Redis indefinitely. Recommend bounded retention (e.g. `removeOnComplete: { age: 86400 }`) once volume grows.
- **Concurrency is 1.** Fine at current approval volume; if admin approval throughput increases, raising `@Processor(MATCHING_QUEUE, { concurrency: N })` (or running a dedicated worker process) is the natural next step — the pipeline has no shared mutable state that would make this unsafe.
- **Local embedding fallback service (`local_embeddings_service/`) is not currently running in any environment**, meaning the only active embedding path today is Cohere; a Cohere outage with the local service also down degrades every in-flight job to rule-based-only scoring (a safe degradation, but worth operational awareness).
- **Existing properties approved before this pipeline shipped** have an empty `embedding` column until they are next re-approved or backfilled; a one-time backfill script would bring the whole existing inventory into full hybrid scoring immediately rather than incrementally.
