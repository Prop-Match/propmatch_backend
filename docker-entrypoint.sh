#!/bin/sh
# PropMatch backend container entrypoint.
#
# 1. Sync the schema. We use `db push`, NOT `migrate deploy`, because the dev
#    branch has migration drift (the customer-support tables have no migration),
#    so `migrate deploy` would produce a DB the app can't use. `db push` makes
#    the DB match schema.prisma exactly.
# 2. Seed a demo world ONCE (only when the DB has no users), so restarts don't
#    wipe data the team added.
# 3. Start Nest.
set -e

echo "[entrypoint] Syncing schema with prisma db push..."
# npx prisma db push --accept-data-loss

echo "[entrypoint] Checking whether the DB needs seeding..."
USERS=$(node -e 'const {Pool}=require("pg");const p=new Pool({connectionString:process.env.DATABASE_URL});p.query("select count(*)::int n from \"user\"").then(r=>{console.log(r.rows[0].n);return p.end()}).catch(()=>{console.log(0)})' 2>/dev/null || echo 0)

if [ "$USERS" = "0" ]; then
  echo "[entrypoint] Empty DB -> seeding demo world..."
  NODE_PATH=.seed-build node .seed-build/prisma/seed.js || echo "[entrypoint] WARN: seed failed, continuing without demo data."
else
  echo "[entrypoint] DB already has $USERS user(s) -> skipping seed."
fi

echo "[entrypoint] Starting NestJS..."
# nest build nests output under dist/src (app.module relies on this for i18n).
exec node dist/src/main
