import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from './prisma.service';

type CountryJson = {
  code: string;
  name: { ar: string; en: string };
  image: string;
};

type GovernorateJson = {
  name: { ar: string; en: string };
};

type CityJson = {
  governors_id: number;
  name: { ar: string; en: string };
};

const prisma: PrismaService = new PrismaService();

async function main() {
  const dataDir = path.join(process.cwd(), 'prisma', 'data');

  // 1. Read JSON files from prisma/data/
  const countryData = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'countries.json'), 'utf-8'),
  ) as unknown as CountryJson;
  const governoratesData = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'egyptian_governorates.json'), 'utf-8'),
  ) as unknown as GovernorateJson[];
  const citiesData = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'egyptian_cities.json'), 'utf-8'),
  ) as unknown as CityJson[];

  console.log('Seeding countries...');
  // Egypt is the only country in the JSON file
  const country = await prisma.country.upsert({
    where: { code: countryData.code },
    update: {
      nameAr: countryData.name.ar,
      nameEn: countryData.name.en,
      image: countryData.image,
      status: true, // Enabled
    },
    create: {
      id: 1,
      code: countryData.code,
      nameAr: countryData.name.ar,
      nameEn: countryData.name.en,
      image: countryData.image,
      status: true,
    },
  });

  console.log('Seeding governorates...');
  // We insert sequentially to make sure the auto-generated database IDs
  // match the array index (which aligning with governors_id in cities)
  for (let i = 0; i < governoratesData.length; i++) {
    const gov = governoratesData[i];
    const govId = i + 1; // 1-indexed ID
    const isDakahlia = gov.name.en === 'Dakahlia';

    await prisma.governorate.upsert({
      where: { id: govId },
      update: {
        nameAr: gov.name.ar,
        nameEn: gov.name.en,
        status: isDakahlia, // Enabled ONLY for Dakahlia
      },
      create: {
        id: govId,
        countryId: country.id,
        nameAr: gov.name.ar,
        nameEn: gov.name.en,
        status: isDakahlia,
      },
    });
  }

  console.log('Seeding cities...');
  // Seed cities sequentially
  for (let i = 0; i < citiesData.length; i++) {
    const city = citiesData[i];
    const cityId = i + 1; // 1-indexed ID
    const isMansoura = city.name.en === 'Mansoura';

    await prisma.city.upsert({
      where: { id: cityId },
      update: {
        nameAr: city.name.ar,
        nameEn: city.name.en,
        status: isMansoura, // Enabled ONLY for Mansoura
      },
      create: {
        id: cityId,
        governorateId: city.governors_id,
        nameAr: city.name.ar,
        nameEn: city.name.en,
        status: isMansoura,
      },
    });
  }

  console.log('Regions seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
