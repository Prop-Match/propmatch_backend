import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../prisma/prisma.service';
import { AppModule } from './../src/app.module';

/**
 * Exercises the admin moderation module end-to-end against a real Postgres
 * database (see docker-compose.yml) — auth guard, roles guard, and the
 * Prisma-backed queue/review logic together, not mocked individually.
 */
describe('AdminController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwt: JwtService;

  const suffix = Date.now();
  let adminId: string;
  let landlordId: string;
  let propertyId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const passwordHash = await bcrypt.hash('Password123!', 10);

    const admin = await prisma.user.create({
      data: {
        fullName: 'Test Admin',
        email: `admin_${suffix}@test.local`,
        phoneNumber: '01012345678',
        passwordHash,
        role: 'ADMIN',
      },
    });
    adminId = admin.id;

    const landlord = await prisma.user.create({
      data: {
        fullName: 'Test Landlord',
        email: `landlord_${suffix}@test.local`,
        phoneNumber: '01098765432',
        passwordHash,
        role: 'LANDLORD',
      },
    });
    landlordId = landlord.id;

    const property = await prisma.property.create({
      data: {
        ownerId: landlord.id,
        title: `Pending property ${suffix}`,
        description: 'A property awaiting moderation.',
        governorate: 'الدقهلية',
        city: 'المنصورة',
        district: 'حي أول',
        manualAddress: 'شارع الجامعة',
        propertyType: 'APARTMENT',
        rentAmount: 3500,
        areaM2: 90,
        bedrooms: 2,
        bathrooms: 1,
        isFurnished: false,
        hasElevator: true,
        hasParking: false,
        status: 'PENDING',
      },
    });
    propertyId = property.id;
  });

  afterAll(async () => {
    await prisma.property.deleteMany({ where: { id: propertyId } });
    await prisma.user.deleteMany({
      where: { id: { in: [adminId, landlordId] } },
    });
    await app.close();
  });

  function tokenFor(user: { id: string; email: string; role: string }) {
    return jwt.sign({ sub: user.id, email: user.email, role: user.role });
  }

  it('rejects unauthenticated requests to /admin/queues', () => {
    return request(app.getHttpServer()).get('/admin/queues').expect(401);
  });

  it('rejects non-admin roles from /admin/queues', () => {
    const token = tokenFor({ id: landlordId, email: 'x', role: 'LANDLORD' });
    return request(app.getHttpServer())
      .get('/admin/queues')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('returns the pending property in the admin queues', async () => {
    const token = tokenFor({ id: adminId, email: 'x', role: 'ADMIN' });
    const res = await request(app.getHttpServer())
      .get('/admin/queues')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as { propertyQueue: { subjectId: string }[] };
    expect(body.propertyQueue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subjectId: propertyId }),
      ]),
    );
  });

  it('returns the admin session with full capabilities', async () => {
    const token = tokenFor({ id: adminId, email: 'x', role: 'ADMIN' });
    const res = await request(app.getHttpServer())
      .get('/admin/session')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as { role: string; capabilities: string[] };
    expect(body.role).toBe('super-admin');
    expect(body.capabilities).toEqual(
      expect.arrayContaining(['property:approve']),
    );
  });

  it('400s a rejection with no reason', async () => {
    const token = tokenFor({ id: adminId, email: 'x', role: 'ADMIN' });
    await request(app.getHttpServer())
      .post(`/admin/properties/${propertyId}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'reject' })
      .expect(400);
  });

  it('approves the pending property', async () => {
    const token = tokenFor({ id: adminId, email: 'x', role: 'ADMIN' });
    const res = await request(app.getHttpServer())
      .post(`/admin/properties/${propertyId}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'approve' })
      .expect(201);

    const body = res.body as { status: string };
    expect(body.status).toBe('APPROVED');
  });

  it('409s reviewing the same property again', async () => {
    const token = tokenFor({ id: adminId, email: 'x', role: 'ADMIN' });
    await request(app.getHttpServer())
      .post(`/admin/properties/${propertyId}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'approve' })
      .expect(409);
  });
});
