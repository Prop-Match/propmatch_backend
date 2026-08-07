import { Injectable } from '@nestjs/common';

export class SbgChatTimeoutError extends Error {}
export class SbgChatUnavailableError extends Error {}
export class SbgChatInvalidResponseError extends Error {}

type SbgChatOptions = {
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
  timeoutMs?: number;
};

@Injectable()
export class SbgChatService {
  async complete(options: SbgChatOptions): Promise<string> {
    const apiKey = process.env.SBG_API_KEY;
    if (!apiKey) throw new SbgChatUnavailableError('SBG chat is unavailable');

    const baseUrl = (
      process.env.SBG_BASE_URL || 'http://apiaccess.iti.net.eg'
    ).replace(/\/$/, '');
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/v1/student/chat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_id: process.env.SBG_CHAT_MODEL || 'openai.gpt-oss-120b-1:0',
          messages: [{ role: 'user', content: options.userContent }],
          system_prompt: options.systemPrompt,
          max_tokens: options.maxTokens,
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError')
      ) {
        throw new SbgChatTimeoutError('SBG chat timed out');
      }
      throw new SbgChatUnavailableError('SBG chat is unavailable');
    }

    if (!response.ok) {
      throw new SbgChatUnavailableError('SBG chat is unavailable');
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new SbgChatInvalidResponseError('SBG chat returned invalid JSON');
    }
    const record = data as Record<string, unknown>;
    const choices = Array.isArray(record.choices)
      ? record.choices[0]
      : undefined;
    const choice = choices as Record<string, unknown> | undefined;
    const message = choice?.message as Record<string, unknown> | undefined;
    const nestedMessage = record.message as Record<string, unknown> | undefined;
    const content = [
      record.output_text,
      record.reply,
      record.content,
      message?.content,
      choice?.text,
      typeof record.message === 'string'
        ? record.message
        : nestedMessage?.content,
    ].find(
      (value): value is string =>
        typeof value === 'string' && value.trim().length > 0,
    );
    if (!content) {
      throw new SbgChatInvalidResponseError('SBG chat returned no content');
    }
    return content;
  }
}
