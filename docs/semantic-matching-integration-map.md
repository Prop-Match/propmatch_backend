# Semantic matching integration map

## Scope and current ownership

There is no `MatchingModule`, matching controller, or matching DTO in this
branch. Two existing flows use the word “match” but serve different purposes:

1. **Semantic property retrieval** is in `PropertiesModule` and uses local
   Sentence Transformers plus Chroma.
2. **Landlord-to-tenant-request scoring** is in `OffersModule` and uses the
   rule-based `scoreRequestAgainstProperty` utility. It is explicitly a
   placeholder for a later semantic score.

The semantic property-search flow now has an inclusive configurable minimum
similarity threshold; this note documents that implementation.

## Current semantic property request flow

```mermaid
flowchart LR
  A[GET /api/properties/search/semantic] --> B[SemanticPropertySearchDto]
  B --> C[PropertiesService.semanticSearch]
  C --> D[PropertyEmbeddingService /embed]
  D --> E[local_embeddings_service]
  E --> F[Chroma cosine query /query]
  F --> G[ordered property IDs]
  G --> H[PostgreSQL: id in IDs AND status APPROVED]
  H --> I[PropertySummaryResponse items]

  J[Admin approves property] --> K[PropertyApprovalIndexingService]
  K --> L[public property search document]
  L --> D
  D --> M[Chroma upsert property:{id}]
```

### Endpoint and request shape

- **Method/route:** `GET /api/properties/search/semantic`
- **Authentication:** none; the route is public.
- **Request DTO:** `SemanticPropertySearchDto` (`query`: required trimmed
  string, 2–300 characters; `limit`: optional integer, default 10, 1–20).
  Example: `?query=near+university&limit=10`.
- **Response:** `{ items, total, resultCount, page: 1, pageSize, reason? }`, where `items` are
  `PropertySummaryResponse` values extended with rounded `semanticSimilarity`
  (four decimal places; cosine range -1 to 1). `resultCount` always equals the
  number of returned items and remains consistent with `total`. A successful
  empty semantic search—whether Chroma returned no candidates, all candidates
  were below threshold, or approved-record hydration removed them—returns
  `reason: "NO_RELEVANT_SEMANTIC_MATCH"`. The response deliberately does
  **not** expose raw vector distance, embeddings, threshold, or collection
  details.
- **Failure behaviour:** unavailable embedding/vector dependencies produce
  HTTP 503 with `SEMANTIC_SEARCH_UNAVAILABLE`; an empty Chroma result is a
  successful empty response.

## Hard filters and retrieval paths

`PropertiesService.semanticSearch` is an ID hydration path. Its only
authoritative SQL filter is `status: 'APPROVED'`; that check happens after the
Chroma lookup. It does not accept or enforce budget, bedrooms, property type,
city/location, or furnishing filters. Therefore it must not be used as the
final implementation of filtered tenant matching without adding SQL filters.

`PropertiesService.search` is the existing, currently un-routed hybrid-search
seam. It builds a Prisma `where` clause before its optional Chroma ID lookup:

| Constraint | Location and behaviour |
| --- | --- |
| Approved/available status | `PropertiesService.search` and `getAll`: `status: 'APPROVED'`; semantic hydration: `status: 'APPROVED'`. “Available” has no separate property-status field in this schema. |
| Maximum budget | `search`: `rentAmount.lte = maxRent`; `getAll` likewise. |
| Minimum bedrooms | `search`: `bedrooms.gte = bedrooms`; `getAll` uses exact equality instead. |
| Property type | `search` and `getAll`: equality filter. |
| City / required location | `search` and `getAll`: city equality only. The rule-based offers path checks whether `preferredLocations` contains `property.district`; it is scoring, not a hard filter. |
| Mandatory furnishing | `search`: when truthy, only `isFurnished: true`; `getAll`: exact boolean when supplied. The offers path only awards points when a furnished property satisfies a furnished request; it does not exclude other properties. |

The public routed browse endpoint, `GET /api/properties`, calls `getAll`, not
`search`. As a result, the `search` hybrid/Chroma code is a competing dormant
path until it is wired to a controller.

## Vector implementation and score semantics

- `PropertyApprovalIndexingService` indexes only an already approved property.
  `PropertySearchDocumentBuilder` accepts a restricted public-property shape:
  title, description, coarse location, type, amenities, and property facts.
  It does not select or embed `manualAddress`, owner identity, phone number, or
  identity-verification data. The local service uses no OpenAI client.
- `local_embeddings_service/app.py` normalizes embedding vectors and creates
  the Chroma collection with `hnsw:space = "cosine"`.
- Chroma returns `distances`; `ChromaPropertyService` maps them to the optional
  `distance` field of `PropertyVectorMatch`. `PropertiesService.semanticSearch`
  converts each finite distance to cosine similarity with `1 - distance` and
  keeps candidates at or above `SEMANTIC_MIN_SIMILARITY`. The configuration
  default is `0.65` and accepted values are in the inclusive `-1` to `1`
  cosine-similarity range. Neither the raw distance nor the threshold is
  returned to the HTTP client.
- For Chroma cosine space, the documented value is cosine **distance**
  `1 - cosine_similarity`. With normalized vectors, the expected mathematical
  range is **0 to 2**: **smaller is better** (0 is identical direction, 1 is
  orthogonal, 2 is opposite). This is the confirmed vector representation; it
  is distinct from the offer utility’s integer 5–98 score, where larger is
  better.
- Low-quality semantic candidates are filtered before property IDs are
  hydrated. The endpoint retains Chroma ordering, validates the `property:{id}`
  convention, removes duplicates, and removes non-approved database rows.

## Existing rule-based matching / offer flow

`GET /api/landlord/requests` is the current landlord-facing matching endpoint.
It requires JWT authentication, `LANDLORD` role, and verified identity. It
returns `{ items }`, with each item containing the approved tenant request’s
non-identity fields, `matchScore`, `alreadyOffered`, and
`bestMatchingProperty`. `OffersService.browseRequests` loads the landlord’s
approved properties and approved tenant requests and ranks them using
`scoreRequestAgainstProperty`.

`src/offers/match-score.util.ts` is a rule-based 5–98, larger-is-better score;
it combines budget, district, type, bedrooms, furnishing, keyword overlap,
flexibility, and boosting. It is not a cosine score, does not call Chroma, and
does not make the listed constraints authoritative exclusions. Tenant request
creation is separately handled by `POST /api/tenant/requests` (JWT, `TENANT`
role, verified identity) through `CreateTenantRequestDto`.

## Recommended future threshold insertion point

`SEMANTIC_MIN_SIMILARITY` is parsed and range-validated by
`SemanticMatchingConfig`, then applied in `PropertiesService.semanticSearch`
after conversion from Chroma distance and before IDs are hydrated. The
threshold is inclusive: `similarity >= minimum` passes.

For tenant matching, preserve the SQL `where` hard filters first, query/rank
only their candidates (or reapply the same filters when hydrating Chroma IDs),
then apply the semantic threshold. This prevents semantic retrieval from
overriding a failed budget, bedrooms, type, location, or furnishing constraint.
The controller is not an appropriate insertion point.

## Duplicate/conflicting implementations and risks

- No dedicated Matching module is present despite the `MatchConnection` schema
  model; offer acceptance creates that connection.
- `PropertiesService.search` has a Chroma-backed hybrid-search seam but no
  controller calls it, while the routed semantic endpoint has a separate,
  less-filtered implementation.
- `getAll` and `search` differ on bedroom and furnishing semantics (exact vs
  minimum/mandatory), so a future unified matching path needs an explicit
  contract decision.
- The offer utility duplicates a frontend mock score by comment and is marked
  as the placeholder for semantic matching. Integrating semantic scores here
  risks competing with that work unless ownership and response-score semantics
  are agreed.
- Existing persisted collections may have been created under prior metadata;
  verify the live collection’s metric before interpreting historical values.
- There are no tests proving vector distance values, threshold behaviour, or
  that every tenant-request constraint is a hard exclusion.
