import * as crypto from 'crypto';

const RAW_KEY = process.env.MESSAGE_ENCRYPTION_KEY || 'propmatch_ai_secure_secret_key_32bytes!!';
const ENCRYPTION_KEY = Buffer.from(RAW_KEY.padEnd(32, '0').slice(0, 32));
const ALGORITHM = 'aes-256-gcm';

/** Encrypts plaintext message using AES-256-GCM before DB persistence. */
export function encryptText(text: string): string {
  if (!text) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `enc:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/** Decrypts stored DB text string safely if encrypted with AES-256-GCM. */
export function decryptText(encryptedText: string): string {
  if (!encryptedText || !encryptedText.startsWith('enc:')) return encryptedText;
  try {
    const parts = encryptedText.split(':');
    if (parts.length < 4) return encryptedText;
    const iv = Buffer.from(parts[1], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');
    const encrypted = parts[3];
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return encryptedText;
  }
}
