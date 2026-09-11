/**
 * Quick local verification for Mail / Redis / BASE_URL
 * Run: npx ts-node scripts/verify-local-email.ts
 * Or:  npm run verify:email
 *
 * Reads BACKEND_PUBLIC_URL, REDIS_URL, SMTP_* from .env.development (via Config)
 * and actually tests connections without sending real OTP.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { URL } from 'url';

// Load .env first, then let .env.development OVERRIDE (local dev should win)
// Matching Nest ConfigModule order: ['.env.development', '.env.production', '.env'] -> first wins.
// For this CLI we explicitly make .env.development override .env.
dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.development'), override: true });

import nodemailer from 'nodemailer';
import { parseRedisConnection } from '../src/matching/redis-connection.util';

async function testBaseUrl() {
  const base = process.env.BACKEND_PUBLIC_URL || process.env.BACKEND_URL || 'http://localhost:3001';
  console.log('\n[BASE_URL] =', base);
  try {
    new URL(base);
    console.log('  ✓ valid URL');
    // Try fetch /api health if running
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/api`);
      console.log(`  fetch ${base}/api -> ${res.status} ${res.statusText}`);
    } catch (e: any) {
      console.log(`  fetch failed (service not running?): ${e.message}`);
    }
  } catch {
    console.log('  ✗ invalid URL — set BACKEND_PUBLIC_URL=http://localhost:3001');
  }
}

async function testRedis() {
  const redisUrl = process.env.REDIS_URL;
  console.log('\n[REDIS_URL] =', redisUrl || '(missing)');
  if (!redisUrl) {
    console.log('  ✗ REDIS_URL missing — BullMQ queue will not drain, emails stuck in "waiting"');
    return;
  }
  try {
    const conn = parseRedisConnection(redisUrl);
    console.log('  ✓ parsed ->', JSON.stringify(conn, null, 2));
    // Try actual TCP connect with ioredis if available
    try {
      const IORedis = (await import('ioredis')).default;
      const client: any = new (IORedis as any)(redisUrl);
      const pong = await client.ping();
      console.log(`  ✓ Redis ping -> ${pong}`);
      await client.quit();
    } catch (e: any) {
      // Fallback to simple socket test if ioredis not installed or Upstash TLS needs check
      console.log(`  ping skipped/failed: ${e.message}`);
      console.log('  hint: for Upstash use rediss:// + tls:{} ; for local Docker use redis://localhost:6380 and `docker compose up -d redis`');
    }
  } catch (e: any) {
    console.log('  ✗ parse failed:', e.message);
  }
}

async function testSmtp() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = (process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;
  console.log('\n[SMTP] host=', host, 'port=', port, 'secure=', secure);
  console.log('  user=', user || '(missing)', 'from=', from || '(default)');
  if (!user || !pass) {
    console.log('  ✗ SMTP_USER/PASS missing — MailWorker will throw in production (mail.worker.ts:38) and silently fail locally');
    return;
  }
  if ((user && !pass) || (!user && pass)) {
    console.log('  ✗ SMTP_USER/PASS must be set together (mail.worker.ts:35)');
    return;
  }
  try {
    const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
    await transporter.verify();
    console.log('  ✓ SMTP verify succeeded — Gmail App Password valid, ready to send OTPs');
    // Optional: send test mail if --send flag
    if (process.argv.includes('--send')) {
      const to = process.argv[process.argv.indexOf('--send') + 1] || user;
      console.log(`  sending test OTP mail to ${to}...`);
      const info = await transporter.sendMail({
        from: from || `"PropMatch" <${user}>`,
        to,
        subject: 'PropMatch local SMTP test — ignore',
        html: '<p>This is a local test from <b>verify-local-email.ts</b>. If you see this, SMTP works.</p>',
      });
      console.log('  ✓ sent:', info.messageId);
    }
  } catch (e: any) {
    console.log('  ✗ SMTP verify failed:', e.message);
    if (e.message.includes('Invalid login') || e.message.includes('535')) {
      console.log('    -> Gmail App Password wrong/expired. Regenerate at https://myaccount.google.com/apppasswords (needs 2FA)');
    }
    if (e.message.includes('ECONNREFUSED')) {
      console.log('    -> Cannot reach smtp.gmail.com — check network / firewall allows port 587');
    }
  }
}

async function main() {
  console.log('=== PropMatch Local Email / Redis / BaseUrl Check ===');
  console.log('CWD:', process.cwd());
  await testBaseUrl();
  await testRedis();
  await testSmtp();
  console.log('\n--- Summary ---');
  console.log('Root 2 (SMTP): see [SMTP] above — must have SMTP_USER/PASS + SMTP_FROM matching Gmail send-as');
  console.log('Root 3 (Gmail): Gmail needs App Password (16 chars, no spaces) + daily limit 500 + check Spam');
  console.log('Root 4 (Dev bypass): EMAIL_OTP_DEV_BYPASS_ENABLED=true lets you test with 123456 without email; set false to force real mail');
  console.log('\nNext: docker compose up -d postgres redis   # start local deps');
  console.log('      npm run start:dev                       # then curl http://localhost:3001/api');
}
main().catch(e => { console.error(e); process.exit(1); });
