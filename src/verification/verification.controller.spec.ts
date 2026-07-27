import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VerificationFilesPipe } from './pipes/verification-files.pipe';
import { MAX_IDENTITY_IMAGE_SIZE } from './validation/identity-image.validator';
import { IdentityImageValidator } from './validation/identity-image.validator';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBP'),
]);

describe('VerificationController multipart submission', () => {
  let app: INestApplication;
  const submit = jest.fn();

  beforeEach(async () => {
    submit.mockReset();
    submit.mockReturnValue({
      status: 'PENDING',
      rejectionReason: null,
      submittedAt: new Date('2026-07-19T10:00:00.000Z'),
      reviewedAt: null,
      canSubmit: false,
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [VerificationController],
      providers: [
        { provide: VerificationService, useValue: { submit } },
        IdentityImageValidator,
        VerificationFilesPipe,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => {
            getRequest: () => {
              headers?: { authorization?: string };
              user?: { userId: string };
            };
          };
        }) => {
          const request = context.switchToHttp().getRequest();
          if (!request.headers || !request.headers.authorization) {
            throw new UnauthorizedException();
          }
          request.user = { userId: 'authenticated-user' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('keeps unauthenticated submissions at 401', async () => {
    await request(app.getHttpServer() as Server)
      .post('/verification/submit')
      .expect(401);
  });

  it('rejects missing, duplicate, invalid-signature, and MIME-mismatched files', async () => {
    await multipartRequest(app)
      .attach('nationalIdFront', jpeg, imageOptions('image/jpeg', 'front.jpg'))
      .attach('nationalIdBack', png, imageOptions('image/png', 'back.png'))
      .expect(400);

    await multipartRequest(app)
      .attach('nationalIdFront', jpeg, imageOptions('image/jpeg', 'front.jpg'))
      .attach(
        'nationalIdFront',
        jpeg,
        imageOptions('image/jpeg', 'front-copy.jpg'),
      )
      .attach('nationalIdBack', png, imageOptions('image/png', 'back.png'))
      .attach('selfie', webp, imageOptions('image/webp', 'selfie.webp'))
      .expect(400);

    await multipartRequest(app)
      .attach(
        'nationalIdFront',
        Buffer.from('MZ'),
        imageOptions('image/jpeg', 'front.jpg'),
      )
      .attach('nationalIdBack', png, imageOptions('image/png', 'back.png'))
      .attach('selfie', webp, imageOptions('image/webp', 'selfie.webp'))
      .expect(400);

    await multipartRequest(app)
      .attach('nationalIdFront', png, imageOptions('image/jpeg', 'front.jpg'))
      .attach('nationalIdBack', png, imageOptions('image/png', 'back.png'))
      .attach('selfie', webp, imageOptions('image/webp', 'selfie.webp'))
      .expect(400);
  });

  it('rejects oversized files and forbidden body fields', async () => {
    const oversized = Buffer.alloc(MAX_IDENTITY_IMAGE_SIZE + 1);
    jpeg.copy(oversized);
    await multipartRequest(app)
      .attach(
        'nationalIdFront',
        oversized,
        imageOptions('image/jpeg', 'front.jpg'),
      )
      .attach('nationalIdBack', png, imageOptions('image/png', 'back.png'))
      .attach('selfie', webp, imageOptions('image/webp', 'selfie.webp'))
      .expect((response) => expect([400, 413]).toContain(response.status));

    await multipartRequest(app)
      .field('userId', 'attacker-controlled')
      .attach('nationalIdFront', jpeg, imageOptions('image/jpeg', 'front.jpg'))
      .attach('nationalIdBack', png, imageOptions('image/png', 'back.png'))
      .attach('selfie', webp, imageOptions('image/webp', 'selfie.webp'))
      .expect(400);
  });

  it('passes normalized files to persistence and returns the safe response', async () => {
    await multipartRequest(app)
      .field('nationalId', 'optional-national-id')
      .attach('nationalIdFront', jpeg, imageOptions('image/jpeg', 'front.jpg'))
      .attach('nationalIdBack', png, imageOptions('image/png', 'back.png'))
      .attach('selfie', webp, imageOptions('image/webp', 'selfie.webp'))
      .expect(200)
      .expect({
        status: 'PENDING',
        rejectionReason: null,
        submittedAt: '2026-07-19T10:00:00.000Z',
        reviewedAt: null,
        canSubmit: false,
      });

    expect(submit).toHaveBeenCalledWith(
      'authenticated-user',
      { nationalId: 'optional-national-id' },
      expect.any(Object),
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const forwardedFiles = submit.mock.calls[0]?.[2] as unknown as Record<
      string,
      { fieldname: string; mimetype: string; size: number; buffer: Buffer }
    >;
    expect(Object.keys(forwardedFiles).sort()).toEqual([
      'nationalIdBack',
      'nationalIdFront',
      'selfie',
    ]);
    for (const [fieldname, file] of Object.entries(forwardedFiles)) {
      expect(file.fieldname).toBe(fieldname);
      expect(typeof file.mimetype).toBe('string');
      expect(typeof file.size).toBe('number');
      expect(Buffer.isBuffer(file.buffer)).toBe(true);
      expect(file).not.toHaveProperty('originalname');
    }
  });
});

function multipartRequest(app: INestApplication) {
  return request(app.getHttpServer() as Server)
    .post('/verification/submit')
    .set('Authorization', 'Bearer test');
}

function imageOptions(contentType: string, filename: string) {
  return { contentType, filename };
}
