import { Injectable } from '@nestjs/common';

export type SearchableProperty = {
  id: string;
  title: string;
  description: string;
  governorate: string;
  city: string;
  district: string;
  propertyType: string;
  propertyAroundServices: string | null;
  rentAmount: number;
  areaM2: number;
  bedrooms: number;
  bathrooms: number;
  isFurnished: boolean;
  hasElevator: boolean;
  hasParking: boolean;
};

export type PropertySearchDocument = {
  document: string;
  metadata: Record<string, string | number | boolean>;
};

/** Produces the public-search representation only; owner and street-address data
 * are intentionally not accepted by this type. */
@Injectable()
export class PropertySearchDocumentBuilder {
  build(property: SearchableProperty): PropertySearchDocument {
    const amenities = [
      property.isFurnished ? 'furnished' : 'unfurnished',
      property.hasElevator ? 'elevator' : null,
      property.hasParking ? 'parking' : null,
      property.propertyAroundServices,
    ].filter((value): value is string => Boolean(value));

    return {
      document: [
        property.title,
        property.description,
        `${property.propertyType} in ${property.district}, ${property.city}, ${property.governorate}`,
        `${property.bedrooms} bedrooms, ${property.bathrooms} bathrooms, ${property.areaM2} m2`,
        amenities.join(', '),
      ]
        .filter(Boolean)
        .join('\n'),
      metadata: {
        propertyId: property.id,
        governorate: property.governorate,
        city: property.city,
        district: property.district,
        propertyType: property.propertyType,
        rentAmount: property.rentAmount,
        areaM2: property.areaM2,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        isFurnished: property.isFurnished,
        hasElevator: property.hasElevator,
        hasParking: property.hasParking,
      },
    };
  }
}
