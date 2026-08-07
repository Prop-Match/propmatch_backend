-- Cached copy of the tenant request's embedding vector, generated once by
-- MatchingWorker and reused by OffersService's synchronous browse/offer
-- endpoints (cosine similarity against Property.embedding, pure local
-- math) — single source of truth so the UI card's matchScore and the
-- proactive notification's finalScore never diverge.
ALTER TABLE "tenant_request" ADD COLUMN "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[];
