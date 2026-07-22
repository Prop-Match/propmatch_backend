import {
  City,
  Governorate,
  Property,
  PropertyImage,
  PropertyStatus,
  PropertyType,
  VerificationStatus,
} from 'generated/prisma/client';

/* ────────────────────── Frontend response interfaces ────────────────────── */

export interface PropertyImageResponse {
  id: string;
  imageUrl: string;
  displayOrder: number;
  isCover: boolean;
}

export interface PropertySummaryResponse {
  id: string;
  title: string;
  governorate: string;
  city: string;
  district: string;
  propertyType: PropertyType;
  rentAmount: number;
  areaM2: number;
  bedrooms: number;
  bathrooms: number;
  isFurnished: boolean;
  isBoosted: boolean;
  status: PropertyStatus;
  coverImage: string | null;
  ownerVerified: boolean;
}

export interface PropertyDetailResponse extends PropertySummaryResponse {
  description: string;
  propertyAroundServices: string | null;
  hasElevator: boolean;
  hasParking: boolean;
  ownerId: string;
  images: PropertyImageResponse[];
  contactRevealed: boolean;
  manualAddress: string | null;
  ownerPhoneNumber: string | null;
  ownerName: string | null;
  rejectionReason: string | null;
  approvedAt: string | null;
  createdAt: string;
}

/* ────────────────── Input types (Prisma query results) ──────────────────── */

type PropertyWithImages = Property & {
  propertyImages: PropertyImage[];
  governorate?: Governorate | null;
  city?: City | null;
  owner?: {
    fullName: string;
    phoneNumber: string;
    /** Included in DETAIL_INCLUDE so ownerVerified can be derived here. */
    identityVerification?: { status: VerificationStatus } | null;
  } | null;
};

/* ──────────────────────────── Mapper functions ──────────────────────────── */

/**
 * Extract the cover image URL from a property's images.
 * Falls back to the first image if no explicit cover is set.
 */
function extractCoverImage(images: PropertyImage[]): string | null {
  return images.find((i) => i.isCover)?.imageUrl ?? images[0]?.imageUrl ?? null;
}

/**
 * Transform a Prisma PropertyImage to the frontend shape.
 */
function transformImage(image: PropertyImage): PropertyImageResponse {
  return {
    id: image.id,
    imageUrl: image.imageUrl,
    displayOrder: image.displayOrder,
    isCover: image.isCover,
  };
}

/**
 * Derive ownerVerified from the owner's identity verification relation.
 * This is the single source of truth — no denormalized flag needed.
 */
function isOwnerVerified(owner: PropertyWithImages['owner']): boolean {
  return owner?.identityVerification?.status === 'APPROVED';
}

import { I18nContext } from 'nestjs-i18n';

/**
 * Transform a Prisma Property (with images) to the frontend summary shape.
 * Used for list / card views — never carries masked PII fields.
 */
export function transformPropertyToSummary(
  property: PropertyWithImages,
  options?: { lang?: string },
): PropertySummaryResponse {
  const currentLang = options?.lang ?? I18nContext.current()?.lang ?? 'ar';
  const isAr = currentLang.startsWith('ar');

  return {
    id: property.id,
    title: property.title,
    governorate: isAr
      ? (property.governorate?.nameAr ?? property.governorate?.nameEn ?? '')
      : (property.governorate?.nameEn ?? property.governorate?.nameAr ?? ''),
    city: isAr
      ? (property.city?.nameAr ?? property.city?.nameEn ?? '')
      : (property.city?.nameEn ?? property.city?.nameAr ?? ''),
    district: property.district,
    propertyType: property.propertyType,
    rentAmount: property.rentAmount,
    areaM2: property.areaM2,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    isFurnished: property.isFurnished,
    isBoosted: property.isBoosted,
    status: property.status,
    coverImage: extractCoverImage(property.propertyImages),
    ownerVerified: isOwnerVerified(property.owner),
  };
}

/**
 * Transform a Prisma Property (with images + owner) to the frontend detail shape.
 *
 * PII gate: `contactRevealed` controls whether the owner's name, phone, and
 * manual address are included. The caller decides based on match/offer status.
 *
 * `ownerVerified` is derived directly from the owner's identityVerification
 * relation — the single source of truth, no extra query needed.
 */
export function transformPropertyToDetail(
  property: PropertyWithImages,
  options: {
    contactRevealed: boolean;
  },
): PropertyDetailResponse {
  const { contactRevealed } = options;

  return {
    ...transformPropertyToSummary(property),
    description: property.description,
    propertyAroundServices: property.propertyAroundServices,
    hasElevator: property.hasElevator,
    hasParking: property.hasParking,
    ownerId: property.ownerId,
    images: property.propertyImages.map(transformImage),
    contactRevealed,
    manualAddress: contactRevealed ? property.manualAddress : null,
    ownerPhoneNumber: contactRevealed
      ? (property.owner?.phoneNumber ?? null)
      : null,
    ownerName: contactRevealed ? (property.owner?.fullName ?? null) : null,
    rejectionReason: null,
    approvedAt: property.approvedAt?.toISOString() ?? null,
    createdAt: property.createdAt.toISOString(),
  };
}
