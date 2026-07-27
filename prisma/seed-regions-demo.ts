import 'dotenv/config';
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

  console.log('Seeding districts for Mansoura...');
  const mansouraCity = await prisma.city.findFirst({
    where: { nameEn: 'Mansoura' },
  });

  if (mansouraCity) {
    const mansouraDistricts = [
      { nameAr: 'حي الجامعة', nameEn: 'University Area' },
      { nameAr: 'المشاية السفلى', nameEn: 'Lower Mashaya' },
      { nameAr: 'المشاية العليا', nameEn: 'Upper Mashaya' },
      { nameAr: 'توريل', nameEn: 'Toriel' },
      { nameAr: 'المختلط', nameEn: 'El Mokhtalatt' },
      { nameAr: 'شارع جيهان', nameEn: 'Jihan Street' },
      { nameAr: 'الترعة', nameEn: 'Al Teraa' },
      { nameAr: 'قناة السويس', nameEn: 'Suez Canal' },
      { nameAr: 'عبد السلام عارف', nameEn: 'Abdel Salam Aref' },
      { nameAr: 'سندوب', nameEn: 'Sandoub' },
      { nameAr: 'المجزر', nameEn: 'El Magzar' },
      { nameAr: 'الحسينية', nameEn: 'El Hosseiniya' },
      { nameAr: 'الثانوية', nameEn: 'Al Thanawiya' },
      { nameAr: 'الدراسات', nameEn: 'El Derasat' },
      { nameAr: 'كفر البدماص', nameEn: 'Kafr El Badmas' },
      { nameAr: 'ميت حدر', nameEn: 'Mit Hadr' },
      { nameAr: 'السكة القديمة', nameEn: 'El Sekka Elqadima' },
      { nameAr: 'السكة الجديدة', nameEn: 'El Sekka Elgedida' },
      { nameAr: 'المحافظة', nameEn: 'ElMohafza' },
      { nameAr: 'جديلة', nameEn: 'Gadila' },
      { nameAr: 'عبود وعزبة عقل', nameEn: 'Abboud & Ezbet Aql' },
      { nameAr: 'مجمع المحاكم', nameEn: 'Mogama Al Mahakim' },
      { nameAr: 'أحمد ماهر', nameEn: 'Ahmed Maher Street' },
      { nameAr: 'قولنجيل', nameEn: 'Qolongil' },
      { nameAr: 'شارع الجيش', nameEn: 'El Geish Street' },
      { nameAr: 'مصر للطيران', nameEn: 'Masr leltiaran' },
      { nameAr: 'مدينة السلام', nameEn: 'Madinat Elsalam' },
      { nameAr: 'مدينة مبارك', nameEn: 'Madinat Mobarak' },
      { nameAr: 'أبو الليل', nameEn: 'Abo Ellil' },
      { nameAr: 'الهدى و النور', nameEn: 'Al Hoda wa al Nour' },
      { nameAr: 'شارع النخلة', nameEn: 'Sharea ElNakhla' },
      { nameAr: 'شارع كلية الآداب', nameEn: 'Sharea ElAdab' },
      { nameAr: 'تقسيم خطاب', nameEn: 'Taqsim Khatab' },
      { nameAr: 'الجلاء', nameEn: 'El Galaa' },
      { nameAr: 'سكة سندوب', nameEn: 'Seket Sandoub' },
      { nameAr: 'العيسوي', nameEn: 'El Eisawy' },
    ];

    for (const d of mansouraDistricts) {
      await prisma.district.upsert({
        where: {
          id:
            (
              await prisma.district.findFirst({
                where: { cityId: mansouraCity.id, nameAr: d.nameAr },
              })
            )?.id || 0,
        },
        update: {
          nameAr: d.nameAr,
          nameEn: d.nameEn,
          status: true,
        },
        create: {
          cityId: mansouraCity.id,
          nameAr: d.nameAr,
          nameEn: d.nameEn,
          status: true,
        },
      });
    }
  }

  console.log('Regions and districts seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
