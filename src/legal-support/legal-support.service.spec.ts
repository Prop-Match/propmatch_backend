import { ConfigService } from '@nestjs/config';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { LegalSupportService } from './legal-support.service';

describe('LegalSupportService', () => {
  const values: Record<string, string> = {
    LEGAL_SUPPORT_API_URL: 'http://localhost:8001/',
    LEGAL_SUPPORT_INTERNAL_API_KEY: 'internal-test-key',
    LEGAL_SUPPORT_TIMEOUT_MS: '5000',
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
  } as unknown as ConfigService;
  const user = { userId: 'user-1', role: 'TENANT' };
  let service: LegalSupportService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    service = new LegalSupportService(config);
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
    jest.clearAllMocks();
  });

  it('forwards buffered chat with internal authentication and user context', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg-1',
          content: 'إجابة',
          declined: false,
          sources: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(service.chat('عقد إيجار', user)).resolves.toMatchObject({
      id: 'msg-1',
      content: 'إجابة',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:8001/legal-chat');
    expect(init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ message: 'عقد إيجار' }),
      headers: {
        'X-Internal-Service-Key': 'internal-test-key',
        'X-PropMatch-User-Id': 'user-1',
        'X-PropMatch-User-Role': 'TENANT',
      },
    });
  });

  it('opens the FastAPI SSE endpoint without buffering it', async () => {
    const upstream = new Response('data: {"type":"done"}\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
    fetchMock.mockResolvedValue(upstream);

    await expect(service.openStream('قانون الإيجار', user)).resolves.toBe(
      upstream,
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:8001/legal-chat/stream');
    expect(init).toMatchObject({
      headers: { Accept: 'text/event-stream' },
    });
  });

  it('maps FastAPI auth and server failures to a gateway error', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 401, message: 'غير مصرح' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(service.chat('عقد', user)).rejects.toMatchObject<
      Partial<HttpException>
    >({ status: 502 });
  });

  it('fails clearly when the internal service boundary is not configured', async () => {
    const missingConfig = {
      get: jest.fn((_key: string, fallback?: unknown) => fallback),
    } as unknown as ConfigService;

    await expect(
      new LegalSupportService(missingConfig).chat('عقد', user),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
