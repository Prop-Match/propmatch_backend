# Real-time engine (PRO-06) — Ali, Week 1

Socket.io gateway that pushes live updates to the browser: admin queue arrivals
and per-user notifications. It is **transport only** — it has no business logic
and stores nothing (except that `notifyUser` persists a `Notification` row
first). The frontend already speaks this exact protocol; this is the server
half.

## For teammates: how to fire a live update

Inject `RealtimeService` anywhere (the module is `@Global`) and call one method.
You never touch sockets, rooms, or event names.

```ts
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class PropertyService {
  constructor(private readonly realtime: RealtimeService) {}

  async create(dto: CreatePropertyDto, ownerId: string) {
    const property = await this.prisma.property.create({ /* ...PENDING... */ });
    this.realtime.propertySubmitted(property);
    return property;
  }
}
```

Week-1 triggers (each pushes `admin:queue:item` to every connected admin):

| Whose task | Call after creating the PENDING row |
|---|---|
| Samer — eKYC | `realtime.kycSubmitted({ userId, userName })` |
| Mostafa — property | `realtime.propertySubmitted(property)` |
| Mostafa — review | `realtime.reviewSubmitted(review)` |
| Mostafa — tenant request | `realtime.tenantRequestSubmitted(request)` |

Week-2 (approvals) — notify one user, persisted then pushed:

```ts
await realtime.notifyUser(ownerId, {
  type: 'PROPERTY_APPROVED',
  title: 'تمت الموافقة على إعلانك',
  message: 'أصبح إعلانك ظاهرًا للمستأجرين الآن.',
  link: `/landlord/properties/${property.id}`,
});
```

## How it works

- **Rooms.** On connect, each socket joins `user:<userId>`; admins additionally
  join `admins`. A notification goes to one `user:<id>` room; a queue item goes
  to `admins`. Isolation is by room, so one user can never receive another's
  data.
- **Two kinds of update, on purpose.**
  - *Queue items* are **ephemeral** — they mirror `GET /api/admin/queues`, which
    is rebuildable from the PENDING rows, so a reconnecting admin catches up on
    fetch. Not stored.
  - *Notifications* are **persisted then pushed** — the row is the truth, the
    socket is just delivery. A user who was offline still gets it on their next
    `GET /api/notifications`.

## Handshake auth (the important part)

The gateway verifies a JWT on connect and rejects (`connect_error:
UNAUTHORIZED`) if it's missing, forged, or expired — **before** the socket
joins any room. It looks for the token in this order:

1. the httpOnly cookie `propmatch_access_token` (how the browser sends it), then
2. `auth: { token }`, then
3. the `Authorization: Bearer` header.

The JWT is verified with the **same `JWT_SECRET`** the AuthModule signs with. If
that env var differs, every socket is rejected.

### ⚠️ Production caveat (needs a decision)
Locally the browser's cookie reaches the gateway because frontend (`:3000`) and
backend (`:3001`) share the `localhost` domain — cookies ignore ports. In
production on **different domains** the cookie will NOT be sent unless it's
`SameSite=None; Secure` with a shared parent domain, or we mint a short-lived
**socket ticket** from the BFF. Frontend `ASSUMPTIONS.md` #28 tracks this.

## Config

| Env | Why |
|---|---|
| `JWT_SECRET` | Must equal AuthModule's — used to verify the handshake JWT. |
| `PORT` | Frontend expects the socket at `:3001` (`NEXT_PUBLIC_SOCKET_URL`). Set `PORT=3001`, or point the frontend env at wherever this runs. |

CORS on the gateway currently reflects the request origin with credentials —
**lock `origin` to the real web origin before production.**

## Test

`realtime.gateway.spec.ts` drives a real Socket.io client through the gateway:
rejects anonymous + forged tokens, delivers queue items to admins only,
delivers notifications to the target user only. Run: `npx jest realtime`.
