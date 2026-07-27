import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface LegalSupportUser {
  userId: string;
  role: string;
}

@Injectable()
export class LegalSupportService {
  constructor(private readonly config: ConfigService) {}

  async chat(message: string, user: LegalSupportUser): Promise<unknown> {
    const response = await this.request('/legal-chat', message, user);
    return this.parseJsonResponse(response);
  }

  async openStream(
    message: string,
    user: LegalSupportUser,
    clientSignal?: AbortSignal,
  ): Promise<Response> {
    const response = await this.request(
      '/legal-chat/stream',
      message,
      user,
      clientSignal,
      'text/event-stream',
    );
    if (!response.body) {
      throw new BadGatewayException('Legal support returned an empty stream.');
    }
    return response;
  }

  private async request(
    path: string,
    message: string,
    user: LegalSupportUser,
    clientSignal?: AbortSignal,
    accept = 'application/json',
  ): Promise<Response> {
    const baseUrl = this.config.get<string>('LEGAL_SUPPORT_API_URL');
    const serviceKey = this.config.get<string>(
      'LEGAL_SUPPORT_INTERNAL_API_KEY',
    );
    if (!baseUrl || !serviceKey) {
      throw new ServiceUnavailableException(
        'Legal support service is not configured.',
      );
    }

    const configuredTimeout = this.config.get<string | number>(
      'LEGAL_SUPPORT_TIMEOUT_MS',
      120000,
    );
    const timeoutMs = Number(configuredTimeout);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new ServiceUnavailableException(
        'LEGAL_SUPPORT_TIMEOUT_MS must be a positive number.',
      );
    }
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = clientSignal
      ? AbortSignal.any([clientSignal, timeoutSignal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        headers: {
          Accept: accept,
          'Content-Type': 'application/json',
          'X-Internal-Service-Key': serviceKey,
          'X-PropMatch-User-Id': user.userId,
          'X-PropMatch-User-Role': user.role,
        },
        body: JSON.stringify({ message }),
        signal,
      });
    } catch (error) {
      if (timeoutSignal.aborted && !clientSignal?.aborted) {
        throw new GatewayTimeoutException('Legal support service timed out.');
      }
      throw new ServiceUnavailableException(
        clientSignal?.aborted
          ? 'Legal support request was cancelled.'
          : 'Legal support service is unavailable.',
        { cause: error },
      );
    }

    if (!response.ok) {
      await this.throwUpstreamError(response);
    }
    return response;
  }

  private async parseJsonResponse(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch (error) {
      throw new BadGatewayException(
        'Legal support returned an invalid JSON response.',
        { cause: error },
      );
    }
  }

  private async throwUpstreamError(response: Response): Promise<never> {
    const body: unknown = await response.json().catch(() => null);
    const status =
      response.status === 400
        ? 400
        : response.status >= 500
          ? 502
          : response.status === 401 || response.status === 403
            ? 502
            : response.status;
    const fallback = {
      statusCode: status,
      message: 'Legal support service rejected the request.',
    };
    throw new HttpException(
      body && typeof body === 'object' ? body : fallback,
      status,
    );
  }
}
