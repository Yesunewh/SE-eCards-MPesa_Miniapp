import type { Ctx } from '../context.js';
import { maybeOne, one } from '../db/pool.js';
import { hashToken, newToken } from '../lib/crypto.js';
import { AppError, EMAIL_RE, badRequest, normMsisdn } from '../lib/util.js';

const SESSION_DAYS = 30;

export interface Customer {
  id: string; msisdn: string; name: string; lang: string;
  deliver_by: 'email' | 'sms'; deliver_email: string | null; deliver_msisdn: string | null; is_blocked: boolean;
}

/** Mini app login: M-Pesa auth code → customer (created on first login) + session token. */
export async function loginWithMpesa(ctx: Ctx, authCode: string, meta: { ip?: string; userAgent?: string } = {}) {
  let user;
  try {
    user = await ctx.payments.exchangeAuthCode(authCode);
  } catch (e) {
    throw new AppError(401, 'login_failed', (e as Error).message);
  }
  const msisdn = normMsisdn(user.msisdn);
  if (!msisdn) throw new AppError(401, 'login_failed', 'M-Pesa returned an unsupported phone number');

  // Match by M-Pesa id first, then by phone (a customer created before ids were known).
  const customer = await one<Customer>(ctx.db, `
    INSERT INTO customers (mpesa_user_id, msisdn, name, deliver_msisdn, last_login_at)
    VALUES ($1, $2, $3, $2, now())
    ON CONFLICT (msisdn) DO UPDATE SET
      mpesa_user_id = COALESCE(customers.mpesa_user_id, EXCLUDED.mpesa_user_id),
      name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE customers.name END,
      last_login_at = now()
    RETURNING *`, [user.userId, msisdn, user.name ?? '']);
  if (customer.is_blocked) throw new AppError(403, 'account_blocked');

  const token = newToken();
  await ctx.db.query(
    `INSERT INTO customer_sessions (customer_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, now() + make_interval(days => $3), $4, $5)`,
    [customer.id, hashToken(token), SESSION_DAYS, meta.ip ?? null, meta.userAgent?.slice(0, 300) ?? null]
  );
  return { token, customer: publicCustomer(customer) };
}

export async function customerFromToken(ctx: Ctx, token: string): Promise<Customer | null> {
  return maybeOne<Customer>(ctx.db, `
    SELECT c.* FROM customer_sessions s JOIN customers c ON c.id = s.customer_id
    WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND NOT c.is_blocked`, [hashToken(token)]);
}

export async function logout(ctx: Ctx, token: string) {
  await ctx.db.query(`UPDATE customer_sessions SET revoked_at = now() WHERE token_hash = $1`, [hashToken(token)]);
}

export function publicCustomer(c: Customer) {
  return {
    id: c.id, name: c.name, msisdn: c.msisdn, lang: c.lang,
    delivery: { by: c.deliver_by, email: c.deliver_email, msisdn: c.deliver_msisdn }
  };
}

/** Where codes go (the "receive by email / SMS" form) and app language. */
export async function updateProfile(ctx: Ctx, customerId: string, p: { lang?: string; deliverBy?: 'email' | 'sms'; email?: string; msisdn?: string }) {
  const email = p.email?.trim();
  if (email !== undefined && email !== '' && !EMAIL_RE.test(email)) throw badRequest('emailInvalid');
  const msisdn = p.msisdn !== undefined && p.msisdn !== '' ? normMsisdn(p.msisdn) : undefined;
  if (p.msisdn && !msisdn) throw badRequest('phoneInvalid');
  const c = await one<Customer>(ctx.db, `
    UPDATE customers SET
      lang = COALESCE($2, lang),
      deliver_by = COALESCE($3, deliver_by),
      deliver_email = COALESCE($4, deliver_email),
      deliver_msisdn = COALESCE($5, deliver_msisdn)
    WHERE id = $1 RETURNING *`, [customerId, p.lang ?? null, p.deliverBy ?? null, email || null, msisdn ?? null]);
  if (c.deliver_by === 'email' && !c.deliver_email) throw badRequest('emailNeeded');
  return publicCustomer(c);
}
