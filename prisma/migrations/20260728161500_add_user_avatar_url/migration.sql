-- The Prisma User model already maps avatarUrl to this nullable column.
-- Keep the migration forward-only so existing users retain a NULL avatar.
ALTER TABLE "user" ADD COLUMN "avatar_url" TEXT;
