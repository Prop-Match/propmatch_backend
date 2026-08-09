import 'dotenv/config';
import { PrismaService } from './prisma.service';

type DuplicateEmail = {
  normalized_email: string;
  count: bigint;
};

async function addConstraint(
  prisma: PrismaService,
  table: string,
  name: string,
  expression: string,
) {
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${expression});
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `);
}

async function main() {
  const prisma = new PrismaService();
  await prisma.onModuleInit();

  try {
    const duplicates = await prisma.$queryRaw<DuplicateEmail[]>`
      SELECT lower(btrim(email)) AS normalized_email, count(*) AS count
      FROM "user"
      GROUP BY lower(btrim(email))
      HAVING count(*) > 1
    `;
    if (duplicates.length > 0) {
      throw new Error(
        `Cannot enforce normalized user emails; duplicates found: ${duplicates
          .map((entry) => entry.normalized_email)
          .join(', ')}`,
      );
    }

    await prisma.$executeRaw`
      UPDATE "user"
      SET email = lower(btrim(email))
      WHERE email <> lower(btrim(email))
    `;
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "user_email_normalized_key"
      ON "user" (lower(btrim(email)))
    `);
    await addConstraint(
      prisma,
      'user',
      'user_email_normalized_check',
      'email = lower(btrim(email)) AND char_length(email) <= 254',
    );

    await addConstraint(
      prisma,
      'user_review',
      'user_review_distinct_parties_check',
      'reviewer_id <> reviewee_id',
    );
    await addConstraint(
      prisma,
      'user_review',
      'user_review_rating_range_check',
      [
        'overall_rating BETWEEN 1 AND 5',
        'communication_rating BETWEEN 1 AND 5',
        'responsiveness_rating BETWEEN 1 AND 5',
        '(property_accuracy_rating IS NULL OR property_accuracy_rating BETWEEN 1 AND 5)',
        '(commitment_rating IS NULL OR commitment_rating BETWEEN 1 AND 5)',
      ].join(' AND '),
    );
    await addConstraint(
      prisma,
      'user_review',
      'user_review_direction_metrics_check',
      [
        "(direction = 'TENANT_TO_LANDLORD' AND property_accuracy_rating IS NOT NULL AND commitment_rating IS NULL)",
        "(direction = 'LANDLORD_TO_TENANT' AND commitment_rating IS NOT NULL AND property_accuracy_rating IS NULL)",
      ].join(' OR '),
    );

    console.log('Custom database constraints are active.');
  } finally {
    await prisma.onModuleDestroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
