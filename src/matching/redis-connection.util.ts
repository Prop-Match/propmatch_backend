import type { ConnectionOptions } from 'bullmq';

/**
 * BullMQ's ConnectionOptions has no "just give it a URL" shape — parse
 * REDIS_URL (redis://[:password@]host:port) into the {host, port, password}
 * form it expects. Throws if REDIS_URL is missing so misconfiguration fails
 * fast at bootstrap instead of surfacing as a silent queue that never drains.
 */
export function parseRedisConnection(
  redisUrl: string | undefined,
): ConnectionOptions {
  if (!redisUrl) {
    throw new Error('REDIS_URL is required for the matching queue (BullMQ).');
  }

  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
  };
}
