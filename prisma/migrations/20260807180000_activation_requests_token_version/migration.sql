-- CreateEnum
CREATE TYPE "ActivationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "token_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "activation_request" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "ActivationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activation_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activation_request_user_id_status_idx" ON "activation_request"("user_id", "status");

-- AddForeignKey
ALTER TABLE "activation_request" ADD CONSTRAINT "activation_request_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
