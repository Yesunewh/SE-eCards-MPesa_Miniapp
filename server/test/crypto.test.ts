import { describe, expect, it } from 'vitest';
import { CodeVault, hashPassword, verifyPassword, last4 } from '../src/lib/crypto.js';
import { normMsisdn, priceMinor, vatIncluded } from '../src/lib/util.js';
import { parseStkCallback, mockCallback } from '../src/adapters/payments/mock.js';
import { SafaricomPayments } from '../src/adapters/payments/safaricom.js';

const vault = new CodeVault(Buffer.alloc(32, 1).toString('base64'), Buffer.alloc(32, 2).toString('base64'));

describe('code vault', () => {
  it('round-trips and never stores the plain code', () => {
    const blob = vault.encrypt('ABCD-EFGH-1234');
    expect(blob.toString('utf8')).not.toContain('ABCD');
    expect(vault.decrypt(blob)).toBe('ABCD-EFGH-1234');
    expect(vault.encrypt('same').equals(vault.encrypt('same'))).toBe(false);   // random IV
  });

  it('detects tampering', () => {
    const blob = vault.encrypt('ABCD-EFGH-1234');
    blob[blob.length - 1]! ^= 1;
    expect(() => vault.decrypt(blob)).toThrow();
  });

  it('fingerprints ignore spacing, dashes and case', () => {
    expect(vault.fingerprint('abcd-efgh 1234').equals(vault.fingerprint('ABCDEFGH1234'))).toBe(true);
    expect(last4('abcd-efgh-12 34')).toBe('1234');
  });
});

describe('passwords', () => {
  it('hashes and verifies', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h).toMatch(/^scrypt\$/);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('money and phones', () => {
  it('prices match the demo: $50 at Br 265 = Br 13,250', () => {
    expect(priceMinor(5000, 265)).toBe(1_325_000);
    expect(priceMinor(5000, 265.37)).toBe(1_326_900);   // rounded to whole Birr
  });
  it('VAT is included in the price', () => {
    expect(vatIncluded(115_00, 0.15)).toBe(15_00);
  });
  it('normalises Ethiopian mobile numbers', () => {
    for (const v of ['0712345678', '+251 712 345 678', '251712345678', '712345678']) expect(normMsisdn(v)).toBe('+251712345678');
    expect(normMsisdn('0912345678')).toBe('+251912345678');
    expect(normMsisdn('0812345678')).toBeNull();
    expect(normMsisdn('+254712345678')).toBeNull();
  });
});

describe('M-Pesa', () => {
  it('parses success and cancel callbacks', () => {
    const ok = parseStkCallback(mockCallback('ws_1', { amountMinor: 1_325_000, msisdn: '+251712345678', receipt: 'ABC123' }))!;
    expect(ok).toMatchObject({ status: 'succeeded', amountMinor: 1_325_000, receiptNumber: 'ABC123', msisdn: '+251712345678' });
    expect(parseStkCallback(mockCallback('ws_2', { ok: false }))!.status).toBe('cancelled');
    expect(parseStkCallback(mockCallback('ws_3', { ok: false, resultCode: 1037 }))!.status).toBe('timeout');
    expect(parseStkCallback(mockCallback('ws_4', { ok: false, resultCode: 2001 }))!.status).toBe('failed');
    expect(parseStkCallback({ hello: 1 })).toBeNull();
  });

  it('builds STK push requests in whole Birr with the Safaricom password', () => {
    const s = new SafaricomPayments({ baseUrl: 'x', consumerKey: 'k', consumerSecret: 's', shortcode: '1020', passkey: 'pk' });
    const r = s.buildStkRequest({ paymentId: 'p1', amountMinor: 1_325_000, msisdn: '+251712345678', reference: 'EC12345678', description: 'eCards EC12345678', callbackUrl: 'https://x/cb' }, '20261031120000');
    expect(r.Amount).toBe(13250);
    expect(r.PhoneNumber).toBe('251712345678');
    expect(Buffer.from(r.Password, 'base64').toString()).toBe('1020pk20261031120000');
    expect(SafaricomPayments.timestamp(new Date('2026-10-31T09:00:00Z'))).toBe('20261031120000');   // EAT = UTC+3
  });
});
