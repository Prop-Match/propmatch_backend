import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { existsSync } from 'fs';
import { AcceptLanguageResolver, I18nModule } from 'nestjs-i18n';
import * as path from 'path';
import { PrismaModule } from 'prisma/prisma.module';
import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { LegalSupportModule } from './legal-support/legal-support.module';
import { MessagesModule } from './messages/messages.module';
import { OffersModule } from './offers/offers.module';
import { PaymentsModule } from './payments/payments.module';
import { PropertiesModule } from './properties/properties.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RegionsModule } from './regions/regions.module';
import { ReviewsModule } from './reviews/reviews.module';
import { TenantRequestsModule } from './tenant-requests/tenant-requests.module';
import { UsersModule } from './users/users.module';
import { VerificationModule } from './verification/verification.module';
import { CustomerSupportModule } from './customer-support/customer-support.module';
import { QuotaModule } from './quota/quota.module';
import { NotificationsModule } from './notifications/notifications.module';
import { FavoritesModule } from './favorites/favorites.module';
import { LeaseContractsModule } from './lease-contracts/lease-contracts.module';
import { MatchingModule } from './matching/matching.module';
import { PartnerLeadsModule } from './partner-leads/partner-leads.module';
import { TenantOffersModule } from './tenant-offers/tenant-offers.module';
import { UploadsModule } from './uploads/uploads.module';
import { PropertyAnalyticsModule } from './property-analytics/property-analytics.module';
import { CommercialConfigModule } from './commercial-config/commercial-config.module';

/**
 * Nest copies `src/i18n` to `dist/i18n`, while compiled modules live under
 * `dist/src`. Resolve from the project root so dev/watch startup cannot select
 * a non-existent `dist/src/i18n` before the asset copy finishes.
 */
const sourceI18nPath = path.join(process.cwd(), 'src', 'i18n');
const builtI18nPath = path.join(process.cwd(), 'dist', 'i18n');
const i18nPath = existsSync(sourceI18nPath) ? sourceI18nPath : builtI18nPath;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // `.env` last so a single `.env` file works for the whole team (the
      // Prisma CLI reads `.env` too). `.env.development` still wins if present.
      envFilePath: ['.env.development', '.env.production', '.env'],
    }),
    ScheduleModule.forRoot(),
    CommercialConfigModule,
    // Registered globally so `UserThrottlerGuard` can be applied surgically to
    // the LLM/AI endpoints (legal chat, support chat, optimizer) via
    // `@UseGuards`/`@Throttle`. Routes without `@Throttle` are unaffected.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 120 }]),
    UsersModule,
    AuthModule,
    AdminModule,
    PrismaModule,
    RealtimeModule,
    I18nModule.forRoot({
      fallbackLanguage: 'ar',
      loaderOptions: {
        path: i18nPath,
        watch: process.env.NODE_ENV !== 'production',
      },
      resolvers: [new AcceptLanguageResolver()],
    }),
    PropertiesModule,
    VerificationModule,
    TenantRequestsModule,
    OffersModule,
    MessagesModule,
    PaymentsModule,
    ReviewsModule,
    LegalSupportModule,
    RegionsModule,
    CustomerSupportModule,
    QuotaModule,
    NotificationsModule,
    FavoritesModule,
    LeaseContractsModule,
    PartnerLeadsModule,
    TenantOffersModule,
    UploadsModule,
    MatchingModule,
    PropertyAnalyticsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
