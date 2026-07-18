import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { SOCKET_EVENTS } from './realtime.contract';


const TEST_SECRET = 'test-secret';

// notifyUser() persists via Prisma; stub it so the test needs no database.
const prismaStub = {
  notification: {
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'ntf_1',
      isRead: false,
      createdAt: new Date('2026-07-17T10:00:00.000Z'),
      link: null,
      ...data,
    })),
  },
};

/** Resolve on the next `event`, or reject after `ms` so a miss fails loudly. */
function once<T = unknown>(socket: Socket, event: string, ms = 1500): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Assert `event` does NOT arrive within `ms` (isolation check). */
function never(socket: Socket, event: string, ms = 400): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    socket.once(event, () => {
      clearTimeout(timer);
      reject(new Error(`unexpectedly received ${event}`));
    });
  });
}

describe('RealtimeGateway', () => {
  let app: INestApplication;
  let service: RealtimeService;
  let jwt: JwtService;
  let url: string;
  const sockets: Socket[] = [];

  const tokenFor = (sub: string, role: string) => jwt.sign({ sub, email: `${sub}@x.com`, role });

  /** Connect a client and wait until it's actually connected. */
  async function connect(opts: { token?: string } = {}): Promise<Socket> {
    const socket = io(url, {
      auth: opts.token ? { token: opts.token } : {},
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    await once(socket, 'connect');
    return socket;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: TEST_SECRET })],
      providers: [
        RealtimeGateway,
        RealtimeService,
        { provide: PrismaService, useValue: prismaStub },
        { provide: ConfigService, useValue: { get: () => TEST_SECRET } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    service = moduleRef.get(RealtimeService);
    jwt = moduleRef.get(JwtService);
    await app.listen(0);
    const port = new URL(await app.getUrl()).port;
    url = `http://localhost:${port}`;
  });

  afterEach(() => {
    while (sockets.length) sockets.pop()?.disconnect();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('handshake auth', () => {
    it('rejects a connection with no token', async () => {
      const socket = io(url, { transports: ['websocket'], reconnection: false });
      sockets.push(socket);
      const message = await once<Error>(socket, 'connect_error');
      expect(message).toMatchObject({ message: 'UNAUTHORIZED' });
    });

    it('rejects a token signed with the wrong secret', async () => {
      const forged = new JwtService({ secret: 'not-the-secret' }).sign({ sub: 'u1', role: 'TENANT' });
      const socket = io(url, { auth: { token: forged }, transports: ['websocket'], reconnection: false });
      sockets.push(socket);
      await expect(once(socket, 'connect_error')).resolves.toMatchObject({ message: 'UNAUTHORIZED' });
    });

    it('accepts a validly signed token', async () => {
      const socket = await connect({ token: tokenFor('usr_tenant', 'TENANT') });
      expect(socket.connected).toBe(true);
    });
  });

  describe('admin queue items', () => {
    it('reaches connected admins', async () => {
      const admin = await connect({ token: tokenFor('usr_admin', 'ADMIN') });
      const received = once(admin, SOCKET_EVENTS.adminQueueItem);

      service.propertySubmitted({ id: 'prop_1', title: 'شقة', district: 'توريل', rentAmount: 4000 });

      await expect(received).resolves.toMatchObject({
        id: 'q_prop_1',
        type: 'property',
        subjectId: 'prop_1',
        subtitle: 'توريل · 4000 ج.م/شهريًا',
      });
    });

    it('does NOT reach non-admins', async () => {
      const tenant = await connect({ token: tokenFor('usr_tenant', 'TENANT') });
      const leaked = never(tenant, SOCKET_EVENTS.adminQueueItem);

      service.tenantRequestSubmitted({
        id: 'req_1',
        preferredLocations: 'حي الجامعة',
        minBudget: 3000,
        maxBudget: 5000,
      });

      await expect(leaked).resolves.toBeUndefined();
    });

    it('builds each queue type with the frontend id prefix and wording', async () => {
      const admin = await connect({ token: tokenFor('usr_admin', 'ADMIN') });

      const review = once(admin, SOCKET_EVENTS.adminQueueItem);
      service.reviewSubmitted({ id: 'rev_1', rating: 4, comment: 'شقة ممتازة وقريبة من كل شيء' });
      await expect(review).resolves.toMatchObject({ id: 'q_rev_1', type: 'review', title: 'تقييم 4★' });

      const kyc = once(admin, SOCKET_EVENTS.adminQueueItem);
      service.kycSubmitted({ userId: 'usr_x', userName: 'أحمد' });
      await expect(kyc).resolves.toMatchObject({ id: 'q_usr_x', type: 'kyc', subjectId: 'usr_x' });
    });
  });

  describe('per-user notifications', () => {
    it('persists then delivers only to the target user', async () => {
      const tenant = await connect({ token: tokenFor('usr_tenant', 'TENANT') });
      const admin = await connect({ token: tokenFor('usr_admin', 'ADMIN') });

      const delivered = once(tenant, SOCKET_EVENTS.notification);
      const leaked = never(admin, SOCKET_EVENTS.notification);

      await service.notifyUser('usr_tenant', {
        type: 'PROPERTY_APPROVED',
        title: 'تمت الموافقة',
        message: 'أصبح إعلانك ظاهرًا',
        link: '/landlord',
      });

      expect(prismaStub.notification.create).toHaveBeenCalled();
      await expect(delivered).resolves.toMatchObject({
        type: 'PROPERTY_APPROVED',
        isRead: false,
      });
      // The payload routes by room; userId must not be in the client data.
      await expect(delivered).resolves.not.toHaveProperty('userId');
      await expect(leaked).resolves.toBeUndefined();
    });
  });
});
