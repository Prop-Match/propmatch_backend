import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PropertyApprovalIndexingService } from '../properties/property-approval-indexing.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const indexing = app.get(PropertyApprovalIndexingService);
  const properties = await prisma.property.findMany({
    where: { status: 'APPROVED' },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  let failures = 0;

  for (const { id } of properties) {
    try {
      await indexing.indexApprovedProperty(id);
    } catch (error) {
      failures += 1;
      indexing.logIndexingFailure(id, error);
    }
  }

  await app.close();
  if (failures > 0) {
    throw new Error(`Reindexing completed with ${failures} failed properties`);
  }
  console.log(`Reindexed ${properties.length} approved properties.`);
}

main().catch((error: unknown) => {
  console.error('Property embedding reindex failed.', error);
  process.exitCode = 1;
});
