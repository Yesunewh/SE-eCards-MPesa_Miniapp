import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

/** Encrypts gift card codes at rest (AES-256-GCM). Output: iv(12) || tag(16) || ciphertext. */
export class CodeVault {
  private readonly encKey: Buffer;
  private readonly macKey: Buffer;
  readonly keyVersion = 1;

  constructor(encKeyB64: string, macKeyB64: string) {
    this.encKey = Buffer.from(encKeyB64, 'base64');
    this.macKey = Buffer.from(macKeyB64, 'base64');
    if (this.encKey.length !== 32 || this.macKey.length !== 32) throw new Error('code keys must be 32 bytes');
  }

  encrypt(plain: string): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.encKey, iv);
    const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), body]);
  }

  decrypt(blob: Buffer): string {
    const d = createDecipheriv('aes-256-gcm', this.encKey, blob.subarray(0, 12));
    d.setAuthTag(blob.subarray(12, 28));
    return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString('utf8');
  }

  /** Keyed hash of a normalised code: detects duplicates without storing the code. */
  fingerprint(code: string): Buffer {
    return createHmac('sha256', this.macKey).update(normaliseCode(code)).digest();
  }
}

export const normaliseCode = (code: string) => code.trim().replace(/[\s-]+/g, '').toUpperCase();
export const last4 = (code: string) => normaliseCode(code).slice(-4);

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest();

const N = 16384, R = 8, P = 1, LEN = 32;
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${h.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), want.length, { N: +n, r: +r, p: +p });
  return got.length === want.length && timingSafeEqual(got, want);
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
