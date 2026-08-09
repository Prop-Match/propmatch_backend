import type {
  BillablePaymentType,
  OwnerPlanName,
} from '../payments/pricing.catalog';

export interface PlanAllowances {
  activeListings: number;
  offers: number;
  aiUses: number;
  boostCredits: number;
  boostDurationDays: number;
}

export interface ResolvedProduct {
  paymentType: BillablePaymentType;
  priceEgp: number;
  enabled: boolean;
  billing: 'MONTHLY' | 'YEARLY' | 'ONE_TIME';
  kind: 'SUBSCRIPTION' | 'ENTITLEMENT' | 'BOOST';
  planType?: Exclude<OwnerPlanName, 'FREE'>;
  entitlementType?: 'ACTIVE_LISTING' | 'MATCHED_OFFER' | 'AI_OPTIMIZER_USE';
  quantity?: number;
  validityDays?: number;
  durationDays?: number;
}

export interface CommercialCatalog {
  plans: Record<OwnerPlanName, PlanAllowances>;
  products: Record<BillablePaymentType, ResolvedProduct>;
}

export interface CatalogSnapshot {
  product: ResolvedProduct;
  planAllowances?: PlanAllowances;
}
