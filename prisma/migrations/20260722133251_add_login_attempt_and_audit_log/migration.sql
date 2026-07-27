-- CreateTable
CREATE TABLE "login_attempt" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ip" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_log_entry" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "login_attempt_created_at_idx" ON "login_attempt"("created_at");

-- CreateIndex
CREATE INDEX "admin_audit_log_entry_at_idx" ON "admin_audit_log_entry"("at");

-- AddForeignKey
ALTER TABLE "login_attempt" ADD CONSTRAINT "login_attempt_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_log_entry" ADD CONSTRAINT "admin_audit_log_entry_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
