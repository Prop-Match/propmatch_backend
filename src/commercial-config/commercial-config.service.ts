import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OwnerPlan, PaymentType, Prisma } from 'generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BILLABLE_PAYMENT_TYPES,
  isBillablePaymentType,
  type BillablePaymentType,
  type OwnerPlanName,
  planAllowances,
  PRICING_CATALOG,
} from '../payments/pricing.catalog';
import { UpdatePlanConfigurationDto } from './dto/update-plan-configuration.dto';
import { UpdateProductConfigurationDto } from './dto/update-product-configuration.dto';
import type {
  CatalogSnapshot,
  CommercialCatalog,
  PlanAllowances,
  ResolvedProduct,
} from './commercial-config.types';

@Injectable()
export class CommercialConfigService {
  constructor(private readonly prisma: PrismaService) {}

  private defaultProduct(paymentType: BillablePaymentType): ResolvedProduct {
    const product = PRICING_CATALOG[paymentType];
    return {
      paymentType,
      ...product,
      enabled: true,
      quantity: 'quantity' in product ? product.quantity : undefined,
      validityDays:
        'validityDays' in product ? product.validityDays : undefined,
      durationDays:
        'durationDays' in product ? product.durationDays : undefined,
      planType: 'planType' in product ? product.planType : undefined,
      entitlementType:
        'entitlementType' in product ? product.entitlementType : undefined,
    };
  }

  async getProduct(paymentType: BillablePaymentType): Promise<ResolvedProduct> {
    const defaults = this.defaultProduct(paymentType);
    const saved = await this.prisma.productConfiguration.findUnique({
      where: { paymentType },
    });
    if (!saved) return defaults;
    return {
      ...defaults,
      priceEgp: saved.priceEgp,
      enabled: saved.enabled,
      quantity:
        defaults.kind === 'ENTITLEMENT'
          ? (saved.quantity ?? defaults.quantity)
          : undefined,
      validityDays:
        defaults.kind === 'ENTITLEMENT'
          ? (saved.validityDays ?? defaults.validityDays)
          : undefined,
      durationDays:
        defaults.kind === 'BOOST'
          ? (saved.durationDays ?? defaults.durationDays)
          : undefined,
    };
  }

  async getPlanAllowances(planType: OwnerPlanName): Promise<PlanAllowances> {
    const defaults = planAllowances(planType);
    const saved = await this.prisma.planConfiguration.findUnique({
      where: { planType },
    });
    return saved
      ? {
          activeListings: saved.activeListings,
          offers: saved.offersPerPeriod,
          aiUses: saved.aiUsesPerPeriod,
          boostCredits: saved.boostCreditsPerPeriod,
          boostDurationDays: saved.boostDurationDays,
        }
      : { ...defaults, boostDurationDays: 7 };
  }

  async getCatalog(): Promise<CommercialCatalog> {
    const [free, ownerPlus, premium, ...products] = await Promise.all([
      this.getPlanAllowances('FREE'),
      this.getPlanAllowances('OWNER_PLUS'),
      this.getPlanAllowances('PREMIUM'),
      ...BILLABLE_PAYMENT_TYPES.map((type) => this.getProduct(type)),
    ]);
    return {
      plans: { FREE: free, OWNER_PLUS: ownerPlus, PREMIUM: premium },
      products: Object.fromEntries(
        products.map((product) => [product.paymentType, product]),
      ) as CommercialCatalog['products'],
    };
  }

  async checkoutSnapshot(
    paymentType: BillablePaymentType,
  ): Promise<CatalogSnapshot> {
    const product = await this.getProduct(paymentType);
    if (!product.enabled) {
      throw new BadRequestException('This product is currently unavailable');
    }
    return {
      product,
      planAllowances: product.planType
        ? await this.getPlanAllowances(product.planType)
        : undefined,
    };
  }

  parseSnapshot(value: Prisma.JsonValue | null): CatalogSnapshot | null {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const product = value.product;
    if (!product || typeof product !== 'object' || Array.isArray(product))
      return null;
    const paymentType = product.paymentType;
    if (typeof paymentType !== 'string' || !isBillablePaymentType(paymentType))
      return null;
    const defaults = this.defaultProduct(paymentType);
    if (product.kind !== defaults.kind || typeof product.priceEgp !== 'number')
      return null;
    return value as unknown as CatalogSnapshot;
  }

  async updateProduct(
    actorId: string,
    paymentTypeValue: string,
    dto: UpdateProductConfigurationDto,
  ): Promise<ResolvedProduct> {
    if (!isBillablePaymentType(paymentTypeValue)) {
      throw new NotFoundException('Commercial product not found');
    }
    const paymentType = paymentTypeValue;
    const defaults = this.defaultProduct(paymentType);
    const data = {
      priceEgp: dto.priceEgp,
      enabled: dto.enabled,
      quantity: defaults.kind === 'ENTITLEMENT' ? dto.quantity : null,
      validityDays: defaults.kind === 'ENTITLEMENT' ? dto.validityDays : null,
      durationDays: defaults.kind === 'BOOST' ? dto.durationDays : null,
      updatedById: actorId,
    };
    if (
      defaults.kind === 'ENTITLEMENT' &&
      (!data.quantity || !data.validityDays)
    ) {
      throw new BadRequestException(
        'Quantity and validity are required for add-ons',
      );
    }
    if (defaults.kind === 'BOOST' && !data.durationDays) {
      throw new BadRequestException('Duration is required for boost products');
    }
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.productConfiguration.upsert({
        where: { paymentType },
        create: { paymentType: paymentType as PaymentType, ...data },
        update: data,
      });
      await tx.adminAuditLogEntry.create({
        data: {
          actorId,
          action: `commercial.product.update:${paymentType}`,
          subjectId: row.id,
        },
      });
    });
    return this.getProduct(paymentType);
  }

  async updatePlan(
    actorId: string,
    planTypeValue: string,
    dto: UpdatePlanConfigurationDto,
  ): Promise<PlanAllowances> {
    if (!Object.values(OwnerPlan).includes(planTypeValue as OwnerPlan)) {
      throw new NotFoundException('Commercial plan not found');
    }
    const planType = planTypeValue as OwnerPlanName;
    const previous = await this.getPlanAllowances(planType);
    const next: PlanAllowances = dto;

    await this.prisma.$transaction(async (tx) => {
      const row = await tx.planConfiguration.upsert({
        where: { planType },
        create: {
          planType,
          activeListings: next.activeListings,
          offersPerPeriod: next.offers,
          aiUsesPerPeriod: next.aiUses,
          boostCreditsPerPeriod: next.boostCredits,
          boostDurationDays: next.boostDurationDays,
          updatedById: actorId,
        },
        update: {
          activeListings: next.activeListings,
          offersPerPeriod: next.offers,
          aiUsesPerPeriod: next.aiUses,
          boostCreditsPerPeriod: next.boostCredits,
          boostDurationDays: next.boostDurationDays,
          updatedById: actorId,
        },
      });

      const quotas = await tx.userQuota.findMany({ where: { planType } });
      for (const quota of quotas) {
        const usedOffers = Math.max(0, previous.offers - quota.freeOffersLeft);
        const usedAi = Math.max(0, previous.aiUses - quota.optimizerUsesLeft);
        const usedBoosts = Math.max(
          0,
          previous.boostCredits - quota.boostCreditsLeft,
        );
        await tx.userQuota.update({
          where: { id: quota.id },
          data: {
            maxActiveListings: next.activeListings,
            freeOffersLeft: Math.max(0, next.offers - usedOffers),
            optimizerUsesLeft: Math.max(0, next.aiUses - usedAi),
            boostCreditsLeft: Math.max(0, next.boostCredits - usedBoosts),
          },
        });
      }
      await tx.adminAuditLogEntry.create({
        data: {
          actorId,
          action: `commercial.plan.update:${planType}`,
          subjectId: row.id,
        },
      });
    });
    return next;
  }
}
