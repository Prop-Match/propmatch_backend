import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from 'generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private static pool: Pool;
  private static adapter: PrismaPg;

  constructor() {
    let connectionString = process.env.DATABASE_URL;

    // Prisma 7 local dev server uses "prisma+postgres://" proxy URLs,
    // but the raw "pg" driver pool only understands "postgres://" or "postgresql://" protocols.
    // We decode the base64 API key to extract the real local Postgres port.
    if (connectionString && connectionString.startsWith('prisma+postgres://')) {
      try {
        const urlObj = new URL(connectionString);
        const apiKey = urlObj.searchParams.get('api_key');
        if (apiKey) {
          const decodedJson = JSON.parse(
            Buffer.from(apiKey, 'base64').toString('utf-8'),
          );
          if (decodedJson.databaseUrl) {
            connectionString = decodedJson.databaseUrl;
          }
        }
      } catch (err) {
        console.error('Failed to parse and decode DATABASE_URL api_key:', err);
      }
    }

    // 1. Create the pg connection pool using the resolved PostgreSQL connection URL
    if (!PrismaService.pool) {
      PrismaService.pool = new Pool({
        connectionString,
      });
      PrismaService.adapter = new PrismaPg(PrismaService.pool);
    }
    // 2. Pass the driver adapter to the parent PrismaClient constructor
    super({ adapter: PrismaService.adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    // End the pool connection to prevent leaking active connections when NestJS shuts down
    await PrismaService.pool.end();
  }
}
