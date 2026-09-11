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
  // Upstash console copies as `redis://...` + separate `--tls` flag (redis-cli --tls -u redis://...)
  // BullMQ/ioredis equivalent is `rediss://` (s = TLS). Be tolerant: enable TLS if
  // scheme is rediss: OR host is Upstash OR explicit ?tls=true (covers pasted CLI string).
  const isTls =
    url.protocol === 'rediss:' ||
    url.hostname.endsWith('.upstash.io') ||
    url.hostname.endsWith('upstash.io') ||
    url.searchParams.get('tls') === 'true' ||
    url.searchParams.get('ssl') === 'true';

  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ...(isTls ? { tls: {} } : {}),
  };
}
