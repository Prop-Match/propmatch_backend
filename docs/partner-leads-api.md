# Partner Leads API

`POST /api/partner-leads` records an optional request for moving or rental-insurance assistance. It is an internal Admin-review queue only: it does not contact, redirect, or share data with an external partner.

Authentication is required. `TENANT` and `LANDLORD` accounts may create a request; `ADMIN` accounts may not.

## Request

```json
{ "serviceType": "MOVING", "consent": true }
```

`serviceType` is either `MOVING` or `INSURANCE`. `consent` must be the boolean `true`; missing, false, null, numeric, or string values are rejected. The endpoint accepts no user, status, partner, external-recipient, contact, KYC, identity-document, or Admin-review fields.

The authenticated principal supplies `userId`; the service supplies `consentedAt`, `PENDING`, and creation timestamps. The safe response contains only `id`, `serviceType`, `status`, `consentedAt`, and `createdAt`.

## Duplicates and notification

An active duplicate is the same authenticated user plus service type with `PENDING` status. It returns `409` and `PARTNER_LEAD_ALREADY_PENDING`. Different service types remain independent.

New rows emit the existing Admin realtime queue event (`admin:queue:item`) as a `partner-lead` item. Its payload identifies only the lead and its review state; it contains no user contact, KYC, document, contract, property-address, credential, or partner data. Socket failure does not roll back a successfully stored lead.

## Limitations

The existing model has no safely authorized contract or property relation, so this endpoint deliberately supports neither optional context field. It also creates no external integration, broker workflow, payment, subscription, advertising, or paid placement.
