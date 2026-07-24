# Customer Support Backend Module (`src/customer-support`)

This document provides high-level architectural guidelines, database entities, and API contracts for the **Customer Support & AI Escalation Engine** in NestJS (`propmatch-backend`), integrated with PostgreSQL (Prisma), Socket.IO (RealtimeService), and the FastAPI AI Microservice.

> ℹ️ *For complete step-by-step code implementation snippets for controllers, services, and DTOs, please refer to the main [implementation_plan.md](../../../.gemini/antigravity/brain/a2a786e8-e366-46b7-bb1a-d28358bac164/implementation_plan.md) artifact.*

---

## 🏗️ Architecture Overview

The backend uses a decoupled, hybrid AI-to-Human workflow:

```mermaid
[Customer (Tenant/Landlord)] ──(HTTP/WS)──► [NestJS CustomerSupportModule] ──(SSE/HTTP)──► [FastAPI AI Microservice]
                                                   │
                                                   ├──► PostgreSQL (`SupportTicket`, `SupportMessage`)
                                                   └──► WebSockets (`RealtimeService` → Admin Inbox)
```

---

## 1. Data Models (`prisma/schema.prisma`)

- **`SupportTicket`**: Persistent entity tracking ticket lifecycle status (`NEW`, `ASSIGNED`, `IN_PROGRESS`, `WAITING`, `CLOSED`), user reference, assigned admin reference, and timestamps.
- **`SupportMessage`**: Individual messages within a ticket thread. Supports author roles (`AI`, `USER`, `ADMIN`) and private internal notes (`internal: true`).

---

## 2. API Endpoint Contracts

### Customer Endpoints (Tenant / Landlord)

- `POST /api/support/tickets`: Create a new support ticket when user requests human support or AI escalates.
- `GET /api/support/my-tickets`: Retrieve list of active and historical tickets for current user.
- `GET /api/support/tickets/:id`: Fetch ticket conversation details.
- `POST /api/support/tickets/:id/reply`: Post a user reply in an existing ticket thread.

### Admin Endpoints (Customer Service & Super Admin)

- `GET /api/admin/support/tickets`: Retrieve all support tickets for the Admin Inbox queue.
- `POST /api/admin/support/tickets/:id/reply`: Send an admin reply or save a private internal team note (`internal: true`).
- `POST /api/admin/support/tickets/:id/assign`: Self-assign ticket to current admin.
- `PATCH /api/admin/support/tickets/:id/status`: Update ticket lifecycle status.

---

## 3. Real-Time WebSocket Events

- `NEW_SUPPORT_TICKET`: Broadcast to `ADMIN` role room when a ticket is created or escalated.
- `SUPPORT_MESSAGE_RECEIVED`: Direct real-time message emitted to regular user room when an admin posts a public reply.
