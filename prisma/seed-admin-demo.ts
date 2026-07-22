import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import 'dotenv/config';
import { LocalPrivateObjectStorageService } from '../src/storage/local-private-object-storage.service';
import { PrismaService } from './prisma.service';

async function main() {
  const prisma = new PrismaService();
  await prisma.onModuleInit();

  const passwordHash = await bcrypt.hash('Password123!', 10);

  // Real files on disk so admin/kyc/:id's createTemporaryReadUrl works
  // against this seed data instead of the old fake CDN URLs.
  const storage = new LocalPrivateObjectStorageService(new ConfigService());
  const dummyImage = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD//gA7Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2NjApLCBxdWFsaXR5ID0gOTAK/9k=',
    'base64',
  );
  const [nationalIdFront, nationalIdBack, selfie] = await Promise.all([
    storage.upload({ data: dummyImage, contentType: 'image/jpeg' }),
    storage.upload({ data: dummyImage, contentType: 'image/jpeg' }),
    storage.upload({ data: dummyImage, contentType: 'image/jpeg' }),
  ]);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@propmatch.local' },
    update: {},
    create: {
      fullName: 'مشرف تجريبي',
      email: 'admin@propmatch.local',
      phoneNumber: '01000000001',
      passwordHash,
      role: 'ADMIN',
    },
  });

  const landlord = await prisma.user.upsert({
    where: { email: 'landlord@propmatch.local' },
    update: {},
    create: {
      fullName: 'مالك تجريبي',
      email: 'landlord@propmatch.local',
      phoneNumber: '01000000002',
      passwordHash,
      role: 'LANDLORD',
    },
  });

  const tenant = await prisma.user.upsert({
    where: { email: 'tenant@propmatch.local' },
    update: {},
    create: {
      fullName: 'مستأجر تجريبي',
      email: 'tenant@propmatch.local',
      phoneNumber: '01000000003',
      passwordHash,
      role: 'TENANT',
    },
  });

  const country = await prisma.country.findUniqueOrThrow({
    where: { code: 'EG' },
  });
  const governorate = await prisma.governorate.findFirstOrThrow({
    where: {
      countryId: country.id,
      nameEn: 'Dakahlia',
    },
  });
  const city = await prisma.city.findFirstOrThrow({
    where: {
      governorateId: governorate.id,
      nameEn: 'Mansoura',
    },
  });

  await prisma.property.create({
    data: {
      ownerId: landlord.id,
      title: 'شقة تجريبية بانتظار المراجعة',
      description: 'شقة واسعة في موقع متميز.',
      countryId: country.id,
      governorateId: governorate.id,
      cityId: city.id,
      district: 'حي أول',
      manualAddress: 'شارع الجامعة',
      propertyType: 'APARTMENT',
      rentAmount: 4000,
      areaM2: 100,
      bedrooms: 3,
      bathrooms: 2,
      isFurnished: true,
      hasElevator: true,
      hasParking: false,
      status: 'PENDING',
    },
  });

  await prisma.identityVerification.upsert({
    where: { userId: tenant.id },
    update: {
      status: 'PENDING',
      nationalIdFrontUrl: nationalIdFront.objectKey,
      nationalIdBackUrl: nationalIdBack.objectKey,
      selfieUrl: selfie.objectKey,
    },
    create: {
      userId: tenant.id,
      nationalId: '29901010112345',
      nationalIdFrontUrl: nationalIdFront.objectKey,
      nationalIdBackUrl: nationalIdBack.objectKey,
      selfieUrl: selfie.objectKey,
      status: 'PENDING',
    },
  });

  await prisma.tenantRequest.create({
    data: {
      tenantId: tenant.id,
      minBudget: 3000,
      maxBudget: 5000,
      preferredLocations: 'المنصورة، طلخا',
      propertyType: 'APARTMENT',
      requiredBedrooms: 2,
      needsFurnished: true,
      flexibilityScore: 3,
      lifestyleRequirements: 'هادئ، قريب من الجامعة',
      status: 'PENDING',
    },
  });

  const approvedProperty = await prisma.property.create({
    data: {
      ownerId: landlord.id,
      title: 'شقة معتمدة للتقييم',
      description: 'شقة تم اعتمادها مسبقًا لإتاحة تقييم عليها.',
      countryId: country.id,
      governorateId: governorate.id,
      cityId: city.id,
      district: 'حي ثان',
      manualAddress: 'شارع النصر',
      propertyType: 'APARTMENT',
      rentAmount: 3500,
      areaM2: 90,
      bedrooms: 2,
      bathrooms: 1,
      isFurnished: false,
      hasElevator: false,
      hasParking: true,
      status: 'APPROVED',
      approvedBy: admin.id,
      approvedAt: new Date(),
    },
  });

  await prisma.propertyReview.create({
    data: {
      reviewerId: tenant.id,
      propertyId: approvedProperty.id,
      rating: 4,
      comment: 'تجربة جيدة بشكل عام مع بعض الملاحظات البسيطة.',
      status: 'PENDING',
    },
  });

  console.log('Seeded demo admin data:');
  console.log('  admin@propmatch.local / Password123!');
  console.log('  landlord@propmatch.local / Password123!');
  console.log('  tenant@propmatch.local / Password123!');

  await prisma.onModuleDestroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
