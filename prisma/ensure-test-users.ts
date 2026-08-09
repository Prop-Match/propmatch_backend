import * as bcrypt from 'bcrypt';
import 'dotenv/config';
import { PrismaService } from './prisma.service';

const TEST_USERS = [
  {
    fullName: 'Demo Admin',
    email: 'admin@propmatch.local',
    phoneNumber: '01000000001',
    role: 'ADMIN' as const,
  },
  {
    fullName: 'Demo Landlord',
    email: 'landlord@propmatch.local',
    phoneNumber: '01000000002',
    role: 'LANDLORD' as const,
  },
  {
    fullName: 'Demo Tenant',
    email: 'tenant@propmatch.local',
    phoneNumber: '01000000003',
    role: 'TENANT' as const,
  },
];

async function main() {
  const password = process.env.TEST_USER_PASSWORD;
  if (!password) {
    throw new Error(
      'TEST_USER_PASSWORD is required when test-user seeding is enabled.',
    );
  }

  const prisma = new PrismaService();
  await prisma.onModuleInit();

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const verifiedAt = new Date();

    for (const user of TEST_USERS) {
      await prisma.user.upsert({
        where: { email: user.email },
        update: {
          ...user,
          passwordHash,
          emailVerifiedAt: verifiedAt,
          emailOtpHash: null,
          emailOtpExpiresAt: null,
          emailOtpAttempts: 0,
          emailOtpSentAt: null,
          isActive: true,
          deletedAt: null,
          suspendedAt: null,
          suspendedUntil: null,
          suspensionReason: null,
          suspensionNote: null,
          suspendedById: null,
        },
        create: {
          ...user,
          passwordHash,
          emailVerifiedAt: verifiedAt,
        },
      });
    }

    const tenant = await prisma.user.findUniqueOrThrow({
      where: { email: 'tenant@propmatch.local' },
    });
    const landlord = await prisma.user.findUniqueOrThrow({
      where: { email: 'landlord@propmatch.local' },
    });
    const property = await prisma.property.findFirst({
      where: { ownerId: landlord.id, status: 'APPROVED' },
      orderBy: { createdAt: 'asc' },
    });

    if (property) {
      const existingMatch = await prisma.matchConnection.findFirst({
        where: {
          tenantId: tenant.id,
          ownerId: landlord.id,
          propertyId: property.id,
        },
      });
      const match =
        existingMatch ??
        (await prisma.matchConnection.create({
          data: {
            tenantId: tenant.id,
            ownerId: landlord.id,
            propertyId: property.id,
            matchScore: 95,
            status: 'CONNECTED',
            agreementReachedAt: verifiedAt,
          },
        }));

      await prisma.leaseContract.upsert({
        where: { matchConnectionId: match.id },
        update: {},
        create: {
          matchConnectionId: match.id,
          generatedByUserId: tenant.id,
          ownerName: landlord.fullName,
          tenantName: tenant.fullName,
          propertyAddress: `${property.district}, ${property.manualAddress}`,
          customClauses: [],
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: new Date('2027-01-01T00:00:00.000Z'),
          rentAmount: property.rentAmount,
          status: 'APPROVED',
          tenantReviewStatus: 'REVIEW_CONFIRMED',
          tenantReviewConfirmedAt: verifiedAt,
          tenantReviewedRevision: 1,
        },
      });
    }

    console.log(
      `Ensured ${TEST_USERS.length} verified test users and review demo data.`,
    );
  } finally {
    await prisma.onModuleDestroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
