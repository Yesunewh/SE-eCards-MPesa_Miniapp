import type { Ctx } from '../context.js';
import { many, maybeOne, one, withTx } from '../db/pool.js';
import { badRequest, isUniqueViolation, notFound, ticketRef } from '../lib/util.js';
import { queueNotification } from './notifications.js';
import type { Customer } from './customers.js';

const TOPICS = ['order', 'payment', 'pre', 'other'] as const;
type Topic = (typeof TOPICS)[number];

/** Customer writes to support (Support screen in the app). */
export async function openTicket(ctx: Ctx, customer: Customer, input: { topic: Topic; text: string; orderId?: string | null }) {
  if (!TOPICS.includes(input.topic)) throw badRequest('bad_topic');
  const text = String(input.text ?? '').trim();
  if (!text || text.length > 4000) throw badRequest('bad_message');
  if (input.orderId) {
    const o = await maybeOne(ctx.db, `SELECT 1 FROM orders WHERE id = $1 AND customer_id = $2`, [input.orderId, customer.id]);
    if (!o) throw notFound('order_not_found');
  }
  return withTx(ctx.db, async tx => {
    for (let i = 0; i < 5; i++) {
      try {
        await tx.query('SAVEPOINT t');
        const t = await one(tx, `INSERT INTO support_tickets (reference, customer_id, order_id, topic, customer_seen_at)
                                 VALUES ($1,$2,$3,$4, now()) RETURNING *`, [ticketRef(), customer.id, input.orderId ?? null, input.topic]);
        await tx.query(`INSERT INTO support_messages (ticket_id, sender, body) VALUES ($1,'customer',$2)`, [t.id, text]);
        return { id: t.id as string, reference: t.reference as string };
      } catch (e) {
        await tx.query('ROLLBACK TO SAVEPOINT t');
        if (!isUniqueViolation(e, 'support_tickets_reference_key')) throw e;
      }
    }
    throw new Error('could not allocate a ticket reference');
  });
}

export async function customerReply(ctx: Ctx, customerId: string, ticketId: string, text: string) {
  text = String(text ?? '').trim();
  if (!text || text.length > 4000) throw badRequest('bad_message');
  await withTx(ctx.db, async tx => {
    const t = await maybeOne(tx, `SELECT id FROM support_tickets WHERE id = $1 AND customer_id = $2 FOR UPDATE`, [ticketId, customerId]);
    if (!t) throw notFound('ticket_not_found');
    await tx.query(`INSERT INTO support_messages (ticket_id, sender, body) VALUES ($1,'customer',$2)`, [ticketId, text]);
    await tx.query(`UPDATE support_tickets SET status = 'open', last_message_at = now(), customer_seen_at = now() WHERE id = $1`, [ticketId]);
  });
}

export async function listTicketsForCustomer(ctx: Ctx, customerId: string) {
  return many(ctx.db, `
    SELECT t.id, t.reference, t.topic, t.status, t.order_id, t.created_at, t.last_message_at,
           EXISTS (SELECT 1 FROM support_messages m WHERE m.ticket_id = t.id AND m.sender = 'support'
                   AND m.created_at > COALESCE(t.customer_seen_at, 'epoch')) AS unread,
           (SELECT json_agg(json_build_object('from', m.sender, 'text', m.body, 'at', m.created_at) ORDER BY m.created_at)
              FROM support_messages m WHERE m.ticket_id = t.id) AS messages
    FROM support_tickets t WHERE t.customer_id = $1 ORDER BY t.last_message_at DESC`, [customerId]);
}

export async function markSeenByCustomer(ctx: Ctx, customerId: string, ticketId: string) {
  await ctx.db.query(`UPDATE support_tickets SET customer_seen_at = now() WHERE id = $1 AND customer_id = $2`, [ticketId, customerId]);
}

/** Support staff answer in the admin panel; the customer gets a short SMS/email pointing to the app. */
export async function staffReply(ctx: Ctx, adminId: string, ticketId: string, text: string, close = false) {
  text = String(text ?? '').trim();
  if (!text || text.length > 4000) throw badRequest('bad_message');
  await withTx(ctx.db, async tx => {
    const t = await maybeOne(tx, `SELECT t.*, c.deliver_by, c.deliver_email, c.deliver_msisdn, c.msisdn FROM support_tickets t
                                  JOIN customers c ON c.id = t.customer_id WHERE t.id = $1 FOR UPDATE OF t`, [ticketId]);
    if (!t) throw notFound('ticket_not_found');
    await tx.query(`INSERT INTO support_messages (ticket_id, sender, admin_user_id, body) VALUES ($1,'support',$2,$3)`, [ticketId, adminId, text]);
    await tx.query(`UPDATE support_tickets SET status = $2, last_message_at = now(), staff_seen_at = now(), assigned_to = COALESCE(assigned_to, $3) WHERE id = $1`,
      [ticketId, close ? 'closed' : 'answered', adminId]);
    const email = t.deliver_by === 'email' && t.deliver_email;
    await queueNotification(tx, { customerId: t.customer_id, channel: email ? 'email' : 'sms', to: email || t.deliver_msisdn || t.msisdn,
      template: 'support_reply', params: { reference: t.reference } });
  });
}

export async function listTicketsForStaff(ctx: Ctx, status?: string) {
  return many(ctx.db, `
    SELECT t.id, t.reference, t.topic, t.status, t.created_at, t.last_message_at, c.name, c.msisdn, o.reference AS order_reference,
           (SELECT json_agg(json_build_object('from', m.sender, 'text', m.body, 'at', m.created_at) ORDER BY m.created_at)
              FROM support_messages m WHERE m.ticket_id = t.id) AS messages
    FROM support_tickets t JOIN customers c ON c.id = t.customer_id LEFT JOIN orders o ON o.id = t.order_id
    WHERE ($1::text IS NULL OR t.status = $1)
    ORDER BY (t.status = 'open') DESC, t.last_message_at DESC LIMIT 200`, [status ?? null]);
}
