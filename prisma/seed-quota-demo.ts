import 'dotenv/config';
import { PrismaService } from './prisma.service';

/**
 * PRO-18 — Freemium quota rows for the demo world (Ali, Week 3).
 *
 * Dev's modular seed builds users/properties/requests but no `UserQuota` rows,
 * so the freemium gate (GET /api/quota, the AI-optimizer drain -> 403
 * QUOTA_EXHAUSTED / AI_ADDON) can't be exercised from a clean seed.
 * This module gives the demo landlord a known Premium Owner entitlement.
 *
 * Runs AFTER seed-admin-demo (alphabetical order in the seed runner), so the
 * `landlord@propmatch.local` user already exists. Tenants intentionally get no
 * quota row — `getQuota` must return null for them, and the UI tolerates it.
 *
 * Run via the seed runner (`npm run prisma:seed`) or on its own.
 */
async function main() {
  const prisma = new PrismaService();
  await prisma.onModuleInit();

  const landlord = await prisma.user.findUniqueOrThrow({
    where: { email: 'landlord@propmatch.local' },
  });

  // The AI-optimizer endpoint is behind VerifiedGuard (APPROVED identity), so
  // an unverified landlord is blocked with VERIFICATION_REQUIRED before the
  // quota gate is ever reached. Mark the demo landlord verified so the freemium
  // flow (and other verified-only landlord actions) is testable end-to-end.
  await prisma.identityVerification.upsert({
    where: { userId: landlord.id },
    update: { status: 'APPROVED', reviewedAt: new Date() },
    create: {
      userId: landlord.id,
      nationalId: '29001010199999',
      nationalIdFrontUrl: 'seed/national-id-front.jpg',
      nationalIdBackUrl: 'seed/national-id-back.jpg',
      selfieUrl: 'seed/selfie.jpg',
      status: 'APPROVED',
      reviewedAt: new Date(),
    },
  });

  const planExpiresAt = new Date();
  planExpiresAt.setMonth(planExpiresAt.getMonth() + 1);

  // The demo landlord already owns two active properties, so seed the aligned
  // Premium Owner plan: five active units, unlimited direct offers, and five
  // included AI uses.
  await prisma.userQuota.upsert({
    where: { userId: landlord.id },
    update: {
      planType: 'PREMIUM',
      planExpiresAt,
      maxActiveListings: 5,
      freeListingsLeft: 0,
      optimizerUsesLeft: 5,
      freeOffersLeft: 3,
    },
    create: {
      planType: 'PREMIUM',
      planExpiresAt,
      maxActiveListings: 5,
      userId: landlord.id,
      freeListingsLeft: 0,
      optimizerUsesLeft: 5,
      freeOffersLeft: 3,
    },
  });

  console.log('Seeded Premium Owner demo entitlement:');
  console.log(
    '  landlord@propmatch.local -> 5 active units / unlimited direct offers / 5 AI uses',
  );

  await prisma.onModuleDestroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
