import { Property, PropertyImage, PropertyStatus, PropertyType } from 'generated/prisma/client';

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
  owner?: { fullName: string; phoneNumber: string } | null;
};

/* ──────────────────────────── Mapper functions ──────────────────────────── */

/**
 * Extract the cover image URL from a property's images.
 * Falls back to the first image if no explicit cover is set.
 */
function extractCoverImage(images: PropertyImage[]): string | null {
  return (
    images.find((i) => i.isCover)?.imageUrl ??
    images[0]?.imageUrl ??
    null
  );
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
 * Transform a Prisma Property (with images) to the frontend summary shape.
 * Used for list / card views — never carries masked PII fields.
 */
export function transformPropertyToSummary(
  property: PropertyWithImages,
  ownerVerified: boolean,
): PropertySummaryResponse {
  return {
    id: property.id,
    title: property.title,
    governorate: property.governorate,
    city: property.city,
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
    ownerVerified,
  };
}

/**
 * Transform a Prisma Property (with images + owner) to the frontend detail shape.
 *
 * PII gate: `contactRevealed` controls whether the owner's name, phone, and
 * manual address are included. The caller decides based on match/offer status.
 */
export function transformPropertyToDetail(
  property: PropertyWithImages,
  options: {
    ownerVerified: boolean;
    contactRevealed: boolean;
  },
): PropertyDetailResponse {
  const { ownerVerified, contactRevealed } = options;

  return {
    ...transformPropertyToSummary(property, ownerVerified),
    description: property.description,
    propertyAroundServices: property.propertyAroundServices,
    hasElevator: property.hasElevator,
    hasParking: property.hasParking,
    ownerId: property.ownerId,
    images: property.propertyImages.map(transformImage),
    contactRevealed,
    manualAddress: contactRevealed ? property.manualAddress : null,
    ownerPhoneNumber: contactRevealed ? (property.owner?.phoneNumber ?? null) : null,
    ownerName: contactRevealed ? (property.owner?.fullName ?? null) : null,
    rejectionReason: null,
    approvedAt: property.approvedAt?.toISOString() ?? null,
    createdAt: property.createdAt.toISOString(),
  };
}
