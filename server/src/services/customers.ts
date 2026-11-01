import type { Ctx } from '../context.js';
import { maybeOne, one, withTx } from '../db/pool.js';
import { hashToken, newToken } from '../lib/crypto.js';
import { AppError, EMAIL_RE, badRequest, isUniqueViolation, normMsisdn } from '../lib/util.js';

const SESSION_DAYS = 30;

export interface Customer {
  id: string; msisdn: string | null; name: string; lang: string;
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
  // the phone number is optional: the mini program may not share it (the customer then gives one at checkout)
  const msisdn = user.msisdn ? normMsisdn(user.msisdn) : null;
  if (user.msisdn && !msisdn) throw new AppError(401, 'login_failed', 'M-Pesa returned an unsupported phone number');
  if (!user.userId && !msisdn) throw new AppError(401, 'login_failed', 'M-Pesa returned no user id');

  const customer = await withTx(ctx.db, async tx => {
    // match by M-Pesa id first, then by phone (a customer created before ids were known)
    let c = user.userId ? await maybeOne<Customer>(tx, `SELECT * FROM customers WHERE mpesa_user_id = $1 FOR UPDATE`, [user.userId]) : null;
    if (!c && msisdn) c = await maybeOne<Customer>(tx, `SELECT * FROM customers WHERE msisdn = $1 FOR UPDATE`, [msisdn]);
    if (c) {
      const taken = msisdn && !c.msisdn ? await maybeOne(tx, `SELECT 1 FROM customers WHERE msisdn = $1 AND id <> $2`, [msisdn, c.id]) : null;
      return one<Customer>(tx, `
        UPDATE customers SET mpesa_user_id = COALESCE(mpesa_user_id, $2), msisdn = COALESCE(msisdn, $3),
          deliver_msisdn = COALESCE(deliver_msisdn, $3),
          name = CASE WHEN $4 <> '' THEN $4 ELSE name END, last_login_at = now()
        WHERE id = $1 RETURNING *`, [c.id, user.userId || null, taken ? null : msisdn, user.name ?? '']);
    }
    return one<Customer>(tx, `
      INSERT INTO customers (mpesa_user_id, msisdn, name, deliver_msisdn, last_login_at)
      VALUES ($1, $2, $3, $2, now()) RETURNING *`, [user.userId || null, msisdn, user.name ?? '']);
  }).catch(async e => {
    // two first logins at the same moment: the other one created the customer
    if (!isUniqueViolation(e)) throw e;
    const c = await maybeOne<Customer>(ctx.db, `SELECT * FROM customers WHERE mpesa_user_id = $1 OR msisdn = $2 LIMIT 1`, [user.userId || null, msisdn]);
    if (!c) throw e;
    return c;
  });
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
