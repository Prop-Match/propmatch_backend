# Rental contract draft API

## Endpoints

- `POST /api/matches/:matchConnectionId/contract/draft`
- `GET /api/contracts/:id`

The existing match-addressed draft route is retained; no parallel `POST /contracts`
route was added. Both endpoints require JWT authentication. Creating/updating a
draft additionally requires the existing `VerifiedGuard` and may be done only
by the landlord of the connected match. Reading is available only to that
match's landlord or tenant; admins have no special contract access.

## Trust boundaries and prerequisites

The `matchConnectionId` must resolve to a `CONNECTED` `MatchConnection` in
which the caller is a party. This is the strongest shared relation produced by
the accepted-offer flows. Owner and tenant names, property address, property
ownership, and the default rent are derived from that match and its property;
the API accepts no user IDs, owner/tenant names, or addresses. Therefore a
landlord cannot select someone else's property or create a contract with an
unrelated tenant.

`LeaseContract` already supplies the required one-contract-per-match unique
constraint, timestamps, structured clause array, monetary amount, dates, and
`DRAFTING` lifecycle state. No schema change or migration was necessary.

## Creation body

```json
{
  "rentAmount": 12500,
  "startDate": "2026-08-01",
  "endDate": "2027-07-31",
  "customClauses": ["No pets without written consent."]
}
```

`rentAmount` is optional and falls back to the connected property's rent; when
provided it must be finite and greater than zero. Dates are required calendar
dates in `YYYY-MM-DD` ISO format, stored at UTC midnight. The end date must be
after the start date. Custom clauses are optional, are preserved verbatim apart
from surrounding whitespace, and allow at most 30 non-empty text entries of
2,000 characters each. Unknown body fields are rejected by the global
validation pipe.

Names and address are not accepted from input, so client-provided empty names
cannot override trusted snapshots. The service also rejects empty or overlong
trusted snapshot values rather than persisting malformed data.

## Safe response

Responses include contract ID, match ID, server-derived party names/address,
rent, dates, clauses, wire status (`drafting` for a new row), creation time,
and the stable disclaimer object:

```json
{
  "disclaimer": {
    "isDraft": true,
    "isElectronicSignature": false,
    "isLegallyAuthenticated": false,
    "message": "هذه مسودة عقد إيجار للمراجعة فقط، وليست توقيعًا إلكترونيًا أو توثيقًا قانونيًا أو تسجيلًا حكوميًا. راجعها قبل التوقيع أو الاعتماد عليها."
  }
}
```

No national IDs, KYC images, selfies, verification notes, passwords, token
hashes, or raw Prisma relation objects are returned by the draft responses.
The legacy contract module contains a later approval/PDF workflow, but this
draft endpoint does not generate a PDF, store signatures, invoke AI, or make
any legal-authentication claim. A future PDF endpoint belongs after an
explicit, separately reviewed approval product decision.

## Existing mock drift

No contract mock was found in this backend repository. Existing contract code
previously exposed masked national-ID fields in some responses; the draft
mapping now omits them. Frontend consumers should use the safe fields above.

## Draft PDF download

`GET /api/contracts/:id/pdf` returns an in-memory, downloadable PDF only when
the saved contract remains `DRAFTING`. The connected landlord and tenant use
the same JWT-based authorization boundary as the contract read endpoint;
admins and unrelated users have no access. It returns `application/pdf` with
an attachment filename, `Content-Length`, and `Cache-Control: private, no-store`.
No public URL or stored PDF is created.

The existing Puppeteer renderer is reused because it produces A4 multi-page
HTML PDFs and is now an explicit runtime dependency. It loads only trusted
in-memory HTML, disables JavaScript, aborts every resource request, bounds
page operations to 15 seconds, and closes both page and browser in `finally`.
The offline template is full Arabic RTL using the deterministic system Arabic
font fallback (`Arial`, `Tahoma`, sans-serif), escapes every dynamic value,
and repeats the draft disclaimer. It includes only saved contract fields:
contract ID, generation date, parties, property address, rent, dates, and
custom clauses. It never includes KYC, signatures, ownership claims, AI, or
legal-authentication/government-registration claims.

Manual visual verification: request a draft PDF containing long Arabic custom
clauses, open every rendered page locally, and verify RTL connected glyphs,
wrapping, margins, and visible disclaimer. Do not store the generated test PDF
under public or tracked application directories. PDF download is implemented;
electronic approval, signing, and legal authentication remain out of scope.
