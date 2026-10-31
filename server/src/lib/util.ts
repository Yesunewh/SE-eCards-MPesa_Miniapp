import { randomInt } from 'node:crypto';

/** Error with an HTTP status and a stable code the app can translate. */
export class AppError extends Error {
  constructor(public status: number, public code: string, message?: string, public details?: unknown) {
    super(message ?? code);
  }
}
export const notFound = (what = 'not_found') => new AppError(404, what);
export const badRequest = (code: string, message?: string, details?: unknown) => new AppError(400, code, message, details);
export const conflict = (code: string, message?: string) => new AppError(409, code, message);

/** Ethiopian mobile number → +2517XXXXXXXX / +2519XXXXXXXX, or null. Same rule as normPhone() in index.html. */
export function normMsisdn(v: unknown): string | null {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.startsWith('251')) d = d.slice(3); else if (d.startsWith('0')) d = d.slice(1);
  return /^[79]\d{8}$/.test(d) ? `+251${d}` : null;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;

/** Birr price of a USD face value, rounded to whole Birr (M-Pesa charges whole Birr). Result in santim. */
export const priceMinor = (faceValueCents: number, rate: number) => Math.round(faceValueCents * rate / 100) * 100;

/** VAT already included in a gross amount. */
export const vatIncluded = (grossMinor: number, vatRate: number) => Math.round(grossMinor * vatRate / (1 + vatRate));

export const orderRef = () => 'EC' + String(randomInt(10_000_000, 100_000_000));
export const ticketRef = () => 'T' + String(randomInt(100_000, 1_000_000));

export const titleOf = (brandName: string, faceValueCents: number) =>
  `${brandName} ${Number.isInteger(faceValueCents / 100) ? faceValueCents / 100 : (faceValueCents / 100).toFixed(2)} USD`;

export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Postgres unique-violation helper. */
export const isUniqueViolation = (e: unknown, constraint?: string) =>
  !!e && (e as any).code === '23505' && (!constraint || (e as any).constraint === constraint);
