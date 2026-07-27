import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LegalSupportController } from './legal-support.controller';
import { LegalSupportService } from './legal-support.service';

describe('LegalSupportController', () => {
  let app: INestApplication;
  const chat = jest.fn();
  const openStream = jest.fn();

  beforeEach(async () => {
    chat.mockReset().mockResolvedValue({
      id: 'msg-1',
      content: 'إجابة',
      declined: false,
      sources: [],
    });
    openStream
      .mockReset()
      .mockResolvedValue(
        new Response(
          'data: {"type":"token","value":"إجابة"}\n\n' +
            'data: {"type":"done","id":"msg-1","declined":false}\n\n',
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      );

    const moduleRef = await Test.createTestingModule({
      controllers: [LegalSupportController],
      providers: [
        {
          provide: LegalSupportService,
          useValue: { chat, openStream },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => {
            getRequest: () => {
              headers: { authorization?: string };
              user?: { userId: string; role: string };
            };
          };
        }) => {
          const req = context.switchToHttp().getRequest();
          if (!req.headers.authorization) throw new UnauthorizedException();
          req.user = { userId: 'user-1', role: 'TENANT' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires the NestJS JWT guard', async () => {
    await request(app.getHttpServer() as Server)
      .post('/legal-chat')
      .send({ message: 'عقد إيجار' })
      .expect(401);
  });

  it('validates and forwards a buffered legal question', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post('/legal-chat')
      .set('Authorization', 'Bearer test')
      .send({ message: '  عقد إيجار  ' })
      .expect(200);

    expect((response.body as { content: string }).content).toBe('إجابة');

    expect(chat).toHaveBeenCalledWith('عقد إيجار', {
      userId: 'user-1',
      role: 'TENANT',
    });
  });

  it('rejects blank messages before FastAPI is called', async () => {
    await request(app.getHttpServer() as Server)
      .post('/legal-chat/stream')
      .set('Authorization', 'Bearer test')
      .send({ message: '   ' })
      .expect(400);

    expect(openStream).not.toHaveBeenCalled();
  });

  it('pipes FastAPI SSE frames through unchanged', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post('/legal-chat/stream')
      .set('Authorization', 'Bearer test')
      .send({ message: 'قانون الإيجار' })
      .expect(200)
      .expect('Content-Type', /text\/event-stream/);

    expect(response.text).toContain('"type":"token"');
    expect(response.text).toContain('"type":"done"');
    expect(response.headers['x-accel-buffering']).toBe('no');
  });
});
