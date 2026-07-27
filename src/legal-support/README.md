# Legal Support Gateway

NestJS is the public gateway for the standalone FastAPI legal RAG service.
The frontend continues to use its generic `/api/backend/*` BFF and therefore
targets only the NestJS origin.

## Flow

```text
Browser -> Next.js BFF -> NestJS JWT guard -> FastAPI internal key -> Chroma/LLM
                         <- unbuffered SSE <-
```

## Public endpoints

- `POST /api/legal-chat` — buffered JSON response.
- `POST /api/legal-chat/stream` — SSE response piped from FastAPI without
  buffering.

Both require the standard NestJS Bearer JWT and accept:

```json
{ "message": "ما هي مدة الإخطار قبل إنهاء عقد الإيجار؟" }
```

The message is trimmed and must contain 1–2000 characters.

## Environment

```dotenv
LEGAL_SUPPORT_API_URL=http://localhost:8001
LEGAL_SUPPORT_INTERNAL_API_KEY=use-the-same-long-random-value-as-fastapi
LEGAL_SUPPORT_TIMEOUT_MS=120000
```

FastAPI must configure the same value as `INTERNAL_SERVICE_API_KEY`. NestJS
does not forward the user's JWT. It sends only the internal credential and the
already-authenticated user ID/role in internal headers.

The frontend must not define `LEGAL_SUPPORT_API_URL`; it needs only the normal
`NESTJS_API_URL`.

## Failure behavior

- Invalid frontend input is rejected by NestJS before FastAPI is contacted.
- FastAPI 401/403 and 5xx responses become a NestJS 502 gateway response.
- Network failures become 503; timeouts become 504.
- SSE headers disable proxy buffering and client disconnects abort the upstream
  request.
