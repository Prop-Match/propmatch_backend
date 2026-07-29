# Week 2 integration setup and manual verification

Start PostgreSQL and the configured Chroma/local-embedding runtime before the backend when semantic search is enabled. Copy `.env.example` to a non-committed `.env` and supply `DATABASE_URL`, `JWT_SECRET`, the existing embedding/Chroma settings, and any PDF/runtime settings used locally. `SEMANTIC_MIN_SIMILARITY=0.65` is the current configurable minimum; it is a product threshold, not a scientifically optimal value.

Run the backend with `npm run start:dev`, then point the frontend BFF at `http://localhost:3001/api`. Semantic search returns a successful no-match response when no candidate reaches the threshold. Tenant-request extraction is authenticated, verified-user suggestions only; users review and submit the normal request form themselves.

Contract PDFs are protected downloads (`private, no-store`) and remain drafts. Tenant review confirmation is not an electronic signature, legal authentication, or registration. Optional moving and rental-insurance requests require explicit consent and are stored for Admin review only; they are not automatically shared with an external provider.

Local checks require suitable tenant and landlord accounts connected to the same contract. No real tokens, identity documents, or provider credentials belong in Postman or frontend configuration.
