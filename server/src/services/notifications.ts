import type { Ctx } from '../context.js';
import type { Queryable } from '../db/pool.js';
import { many, maybeOne } from '../db/pool.js';
import { enqueue } from './jobs.js';

export interface QueueInput {
  customerId?: string; orderId?: string; channel: 'email' | 'sms'; to: string;
  template: 'codes_delivered' | 'preorder_waiting' | 'support_reply' | 'back_in_stock';
  params: Record<string, unknown>;   // ids and references only, never codes
}

export async function queueNotification(q: Queryable, n: QueueInput) {
  const r = await q.query(
    `INSERT INTO notifications (customer_id, order_id, channel, recipient, template, params) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [n.customerId ?? null, n.orderId ?? null, n.channel, n.to, n.template, n.params]);
  await enqueue(q, 'send_notification', { notificationId: r.rows[0].id }, { maxAttempts: 6 });
}

/** Job: render and send one message. Codes are decrypted only here, at send time. */
export async function sendNotificationJob(ctx: Ctx, payload: { notificationId: string }) {
  const n = await maybeOne(ctx.db, `SELECT * FROM notifications WHERE id = $1`, [payload.notificationId]);
  if (!n || n.status === 'sent') return;
  const { subject, text } = await render(ctx, n);
  try {
    const r = await ctx.notifier.send({ channel: n.channel, to: n.recipient, subject, text });
    await ctx.db.query(`UPDATE notifications SET status = 'sent', sent_at = now(), attempts = attempts + 1, provider_message_id = $2 WHERE id = $1`, [n.id, r.messageId]);
  } catch (e) {
    await ctx.db.query(`UPDATE notifications SET attempts = attempts + 1, last_error = $2, status = CASE WHEN attempts + 1 >= 6 THEN 'failed' ELSE status END WHERE id = $1`,
      [n.id, (e as Error).message.slice(0, 500)]);
    throw e;
  }
}

// English only for now; Amharic, Oromo, Somali and Tigrinya texts should be written by native speakers.
async function render(ctx: Ctx, n: any): Promise<{ subject: string; text: string }> {
  const p = n.params ?? {};
  switch (n.template) {
    case 'codes_delivered': {
      const codes = await many(ctx.db, `
        SELECT g.code_enc, g.pin_enc, i.title FROM gift_codes g JOIN order_items i ON i.id = g.order_item_id
        WHERE g.id = ANY($1) ORDER BY i.line_no, g.sold_at`, [p.codeIds ?? []]);
      const lines = codes.map(c => `${c.title}: ${ctx.vault.decrypt(c.code_enc)}${c.pin_enc ? ` PIN ${ctx.vault.decrypt(c.pin_enc)}` : ''}`);
      return {
        subject: `Your eCards order ${p.reference}`,
        text: `eCards order ${p.reference}\n${lines.join('\n')}\nKeep these codes private. Gift cards cannot be returned.`
      };
    }
    case 'preorder_waiting':
      return { subject: `Pre-order ${p.reference} confirmed`, text: `eCards: payment received for ${p.reference}. Some cards are pre-orders; we will send the codes as soon as they arrive.` };
    case 'support_reply':
      return { subject: `Reply to your message ${p.reference}`, text: `eCards support replied to ${p.reference}. Open the eCards mini app in M-Pesa to read it.` };
    case 'back_in_stock':
      return { subject: `${p.title} is back`, text: `eCards: ${p.title} is back in stock.` };
    default:
      return { subject: 'eCards', text: 'eCards' };
  }
}
