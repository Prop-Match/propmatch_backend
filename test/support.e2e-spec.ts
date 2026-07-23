import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { I18nValidationPipe } from 'nestjs-i18n';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../prisma/prisma.service';
import { AppModule } from './../src/app.module';

/**
 * Exercises the full support-ticket cycle end-to-end against a real
 * Postgres database: the AI service's handoff call creates a ticket, then
 * an admin lists/views/replies/assigns/closes it — the same sequence
 * `transfer_to_human_support` → `admin/tickets/*` the frontend already
 * expects (src/lib/api/contracts/support.ts).
 */
describe('Support tickets (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwt: JwtService;
  let internalServiceKey: string;

  const suffix = Date.now();
  let adminId: string;
  let tenantId: string;
  let ticketId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // main.ts applies this globally at bootstrap; the isolated test module
    // needs it too so DTO validation (e.g. the status enum) is exercised.
    app.useGlobalPipes(
      new I18nValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    const config = app.get(ConfigService);
    internalServiceKey = config.get<string>('LEGAL_SUPPORT_INTERNAL_API_KEY')!;
    if (!internalServiceKey) {
      throw new Error(
        'LEGAL_SUPPORT_INTERNAL_API_KEY must be set to run this suite',
      );
    }

    const passwordHash = await bcrypt.hash('Password123!', 10);

    const admin = await prisma.user.create({
      data: {
        fullName: 'Test Support Admin',
        email: `support_admin_${suffix}@test.local`,
        phoneNumber: '01011112222',
        passwordHash,
        role: 'ADMIN',
      },
    });
    adminId = admin.id;

    const tenant = await prisma.user.create({
      data: {
        fullName: 'Test Support Tenant',
        email: `support_tenant_${suffix}@test.local`,
        phoneNumber: '01033334444',
        passwordHash,
        role: 'TENANT',
      },
    });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await prisma.supportMessage.deleteMany({
      where: { ticket: { userId: tenantId } },
    });
    await prisma.supportTicket.deleteMany({ where: { userId: tenantId } });
    await prisma.user.deleteMany({
      where: { id: { in: [adminId, tenantId] } },
    });
    await app.close();
  });

  function tokenFor(user: { id: string; email: string; role: string }) {
    return jwt.sign({ sub: user.id, email: user.email, role: user.role });
  }

  it('rejects a handoff call without the internal service key', () => {
    return request(app.getHttpServer())
      .post('/support/handoff')
      .send({ user_id: tenantId, chat_summary: 'unauthorized attempt' })
      .expect(401);
  });

  it('creates a ticket via the AI service handoff', async () => {
    const res = await request(app.getHttpServer())
      .post('/support/handoff')
      .set('X-Internal-Service-Key', internalServiceKey)
      .send({
        user_id: tenantId,
        chat_summary: 'المستخدم يسأل عن استرداد مبلغ الدفع',
      })
      .expect(201);

    const body = res.body as {
      id: string;
      status: string;
      messages: { author: string; content: string }[];
    };
    ticketId = body.id;
    expect(body.status).toBe('new');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({
      author: 'ai',
      content: 'المستخدم يسأل عن استرداد مبلغ الدفع',
    });
  });

  it('404s a handoff for an unknown user', () => {
    return request(app.getHttpServer())
      .post('/support/handoff')
      .set('X-Internal-Service-Key', internalServiceKey)
      .send({
        user_id: '00000000-0000-0000-0000-000000000000',
        chat_summary: 'x',
      })
      .expect(404);
  });

  it('rejects unauthenticated requests to /admin/tickets', () => {
    return request(app.getHttpServer()).get('/admin/tickets').expect(401);
  });

  it('rejects non-admin roles from /admin/tickets', () => {
    const token = tokenFor({ id: tenantId, email: 'x', role: 'TENANT' });
    return request(app.getHttpServer())
      .get('/admin/tickets')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('lists the new ticket for an admin', async () => {
    const token = tokenFor({ id: adminId, email: 'x', role: 'ADMIN' });
    const res = await request(app.getHttpServer())
      .get('/admin/tickets')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as { items: { id: string; status: string }[] };
    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: ticketId, status: 'new' }),
      ]),
    );
  });

  it('assigns the ticket to the admin and flips status to assigned', async () => {
    const token = tokenFor({ id: adminId, email: 'x', role: 'ADMIN' });
    const res = await request(app.getHttpServer())
      .post(`/admin/tickets/${ticketId}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as { status: string; assignedAdminId: string };
    expect(body.status).toBe('assigned');
    expect(body.assignedAdminId).toBe(adminId);
  });

  it('adding an internal note does not advance the ticket status', async () => {
    const token = tokenFor({ id: adminId, email: 'x', role: 'ADMIN' });
    const res = await request(app.getHttpServer())
      .post(`/admin/tickets/${ticketId}/reply`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'ملاحظة داخلية فقط', internal: true })
      .expect(200);

    const body = res.body as { status: string };
    expect(body.status).toBe('assigned');
  });

  it('replying to the customer moves the ticket to in_progress', async () => {
    const token = tokenFor({ id: adminId, email: 'x', role: 'ADMIN' });
    const res = await request(app.getHttpServer())
      .post(`/admin/tickets/${ticketId}/reply`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'أهلاً، جاري مراجعة طلبك.' })
      .expect(200);

    const body = res.body as {
      status: string;
      messages: { author: string; internal: boolean; authorName: string }[];
    };
    expect(body.status).toBe('in_progress');
    const lastMessage = body.messages[body.messages.length - 1];
    expect(lastMessage).toMatchObject({ author: 'admin', internal: false });
    expect(lastMessage.authorName).toBe('Test Support Admin');
  });

  it('closes the ticket via the status endpoint', async () => {
    const token = tokenFor({ id: adminId, email: 'x', role: 'ADMIN' });
    const res = await request(app.getHttpServer())
      .post(`/admin/tickets/${ticketId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'closed' })
      .expect(200);

    const body = res.body as { status: string };
    expect(body.status).toBe('closed');
  });

  it('400s an invalid status value', async () => {
    const token = tokenFor({ id: adminId, email: 'x', role: 'ADMIN' });
    await request(app.getHttpServer())
      .post(`/admin/tickets/${ticketId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'not_a_real_status' })
      .expect(400);
  });

  it('404s fetching a ticket that does not exist', async () => {
    const token = tokenFor({ id: adminId, email: 'x', role: 'ADMIN' });
    await request(app.getHttpServer())
      .get('/admin/tickets/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
