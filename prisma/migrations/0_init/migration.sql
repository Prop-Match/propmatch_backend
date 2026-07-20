-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('TENANT', 'LANDLORD', 'ADMIN');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('APARTMENT', 'VILLA', 'STUDIO');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('INTERESTED', 'CONNECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('NEW_LISTING', 'BOOST_LISTING', 'REFILL_MATCHES', 'OFFER_PACK');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('EKYC_APPROVED', 'PROPERTY_APPROVED', 'NEW_MATCH', 'PAYMENT_SUCCESS', 'NEW_REVIEW_SUBMITTED', 'REVIEW_APPROVED', 'NEW_TENANT_REQUEST', 'NEW_OFFER_RECEIVED');

-- CreateEnum
CREATE TYPE "TenantRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FULFILLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OwnerOfferStatus" AS ENUM ('SENT', 'VIEWED', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PartnerServiceType" AS ENUM ('MOVING', 'INSURANCE');

-- CreateEnum
CREATE TYPE "PartnerLeadStatus" AS ENUM ('PENDING', 'SENT', 'CONVERTED');

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'TENANT',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_verification" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "national_id" TEXT NOT NULL,
    "national_id_front_url" TEXT NOT NULL,
    "national_id_back_url" TEXT NOT NULL,
    "selfie_url" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "rejection_reason" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "identity_verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_quota" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "free_listings_left" INTEGER NOT NULL DEFAULT 1,
    "optimizer_uses_left" INTEGER NOT NULL DEFAULT 2,
    "free_offers_left" INTEGER NOT NULL DEFAULT 3,
    "last_reset_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_quota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "governorate" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "manual_address" TEXT NOT NULL,
    "property_type" "PropertyType" NOT NULL,
    "property_around_services" TEXT,
    "rent_amount" DOUBLE PRECISION NOT NULL,
    "area_m2" DOUBLE PRECISION NOT NULL,
    "bedrooms" INTEGER NOT NULL,
    "bathrooms" INTEGER NOT NULL,
    "is_furnished" BOOLEAN NOT NULL,
    "has_elevator" BOOLEAN NOT NULL,
    "has_parking" BOOLEAN NOT NULL,
    "contact_revealed" BOOLEAN NOT NULL DEFAULT false,
    "status" "PropertyStatus" NOT NULL DEFAULT 'PENDING',
    "is_boosted" BOOLEAN NOT NULL DEFAULT false,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_image" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "image_url" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL,
    "is_cover" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_review" (
    "id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_request" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "min_budget" DOUBLE PRECISION NOT NULL,
    "max_budget" DOUBLE PRECISION NOT NULL,
    "preferred_locations" TEXT NOT NULL,
    "property_type" "PropertyType" NOT NULL,
    "required_bedrooms" INTEGER NOT NULL,
    "needs_furnished" BOOLEAN NOT NULL,
    "flexibility_score" INTEGER NOT NULL,
    "lifestyle_requirements" TEXT NOT NULL,
    "status" "TenantRequestStatus" NOT NULL DEFAULT 'PENDING',
    "approved_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_offer" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "tenant_request_id" UUID NOT NULL,
    "property_id" UUID,
    "pitch_message" TEXT NOT NULL,
    "proposed_price" DOUBLE PRECISION NOT NULL,
    "status" "OwnerOfferStatus" NOT NULL DEFAULT 'SENT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorite" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_connection" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "match_score" DOUBLE PRECISION NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'INTERESTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "match_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transaction" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "paymob_order_id" TEXT NOT NULL,
    "paymob_transaction_id" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "payment_type" "PaymentType" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lease_contract" (
    "id" UUID NOT NULL,
    "generated_by_user_id" UUID NOT NULL,
    "owner_name" TEXT NOT NULL,
    "owner_national_id" TEXT NOT NULL,
    "tenant_name" TEXT NOT NULL,
    "tenant_national_id" TEXT NOT NULL,
    "property_address" TEXT NOT NULL,
    "custom_clauses" TEXT,
    "pdf_url" TEXT,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "rent_amount" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lease_contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_lead" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "service_type" "PartnerServiceType" NOT NULL,
    "partner_name" TEXT NOT NULL,
    "status" "PartnerLeadStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "identity_verification_user_id_key" ON "identity_verification"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_quota_user_id_key" ON "user_quota"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "favorite_tenant_id_property_id_key" ON "favorite"("tenant_id", "property_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transaction_paymob_order_id_key" ON "payment_transaction"("paymob_order_id");

-- AddForeignKey
ALTER TABLE "identity_verification" ADD CONSTRAINT "identity_verification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_verification" ADD CONSTRAINT "identity_verification_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_quota" ADD CONSTRAINT "user_quota_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property" ADD CONSTRAINT "property_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property" ADD CONSTRAINT "property_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_image" ADD CONSTRAINT "property_image_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_review" ADD CONSTRAINT "property_review_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_review" ADD CONSTRAINT "property_review_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_review" ADD CONSTRAINT "property_review_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_request" ADD CONSTRAINT "tenant_request_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_request" ADD CONSTRAINT "tenant_request_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_offer" ADD CONSTRAINT "owner_offer_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_offer" ADD CONSTRAINT "owner_offer_tenant_request_id_fkey" FOREIGN KEY ("tenant_request_id") REFERENCES "tenant_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_offer" ADD CONSTRAINT "owner_offer_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_connection" ADD CONSTRAINT "match_connection_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_connection" ADD CONSTRAINT "match_connection_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_connection" ADD CONSTRAINT "match_connection_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transaction" ADD CONSTRAINT "payment_transaction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_contract" ADD CONSTRAINT "lease_contract_generated_by_user_id_fkey" FOREIGN KEY ("generated_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_lead" ADD CONSTRAINT "partner_lead_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
