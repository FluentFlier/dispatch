import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { isProduction } from '@/lib/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * True for any deployed environment, not just NODE_ENV==='production'.
 * Preview/staging deploys (where NODE_ENV may be 'development') must still
 * require the encryption key so OAuth tokens are never stored in cleartext.
 * Only genuine local development is allowed the plaintext fallback.
 */
/**
 * Returns true for any deployed environment, not just NODE_ENV=production.
 * Previously only checked Vercel-specific vars - Railway, Render, Fly.io, and
 * any host with TOKEN_ENCRYPTION_KEY set would silently store plaintext tokens.
 */
function isDeployedEnv(): boolean {
  if (isProduction()) return true;
  if (process.env.VERCEL === '1') return true;
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === 'preview' || vercelEnv === 'production') return true;
  // Other common hosting platforms
  if (process.env.RAILWAY_ENVIRONMENT) return true;
  if (process.env.FLY_APP_NAME) return true;
  if (process.env.RENDER) return true;
  // If the key is explicitly set, the operator intends encryption - require it.
  if (process.env.TOKEN_ENCRYPTION_KEY) return true;
  return false;
}

function getEncryptionKey(): Buffer | null {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) return null;
  return Buffer.from(hex, 'hex');
}

function requireEncryptionKey(): Buffer {
  const key = getEncryptionKey();
  if (!key) {
    if (isDeployedEnv()) {
      throw new Error('TOKEN_ENCRYPTION_KEY is required in any deployed environment');
    }
    throw new Error('TOKEN_ENCRYPTION_KEY missing. Generate with: openssl rand -hex 32');
  }
  return key;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a string in the format `iv:ciphertext:tag` (all base64).
 * In any deployed environment, fails if TOKEN_ENCRYPTION_KEY is missing.
 */
export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) {
    if (isDeployedEnv()) {
      requireEncryptionKey();
    }
    return plaintext;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    encrypted.toString('base64'),
    tag.toString('base64'),
  ].join(':');
}

/**
 * Decrypts a token previously encrypted by encryptToken.
 * Expects the format `iv:ciphertext:tag` (all base64).
 * If TOKEN_ENCRYPTION_KEY is not set, returns the input unchanged (dev fallback).
 */
export function decryptToken(encrypted: string): string {
  const key = getEncryptionKey();
  if (!key) {
    if (isDeployedEnv() && encrypted.includes(':')) {
      requireEncryptionKey();
    }
    return encrypted;
  }

  const parts = encrypted.split(':');
  // Malformed format with an active key means the stored value is corrupted or
  // was never encrypted. Returning it as-is would pass a garbage string to the
  // platform API and produce a confusing downstream error. Throw explicitly so
  // callers know the credential is unusable.
  if (parts.length !== 3) {
    throw new Error('[crypto] Malformed encrypted token - expected iv:ciphertext:tag format');
  }

  const [ivB64, ciphertextB64, tagB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
