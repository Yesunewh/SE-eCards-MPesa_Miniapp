/**
 * A stand-in Wupex server that answers like the real sandbox (checked 2026-11-02), with scripted trouble for tests:
 *   - errors come back as HTTP 200 { status:false, description }
 *   - pull-codes takes ?referenceId=&allowTakeAll=, answers without codes; codes are read with order/detail
 *   - a repeated referenceId answers ALREADY_COMPLETED for the same order and charges nothing
 *   - short stock on a pre-order product: what is in stock now, the rest later (supply()) or never (failPreorder())
 */
import Fastify from 'fastify';
import { randomBytes } from 'node:crypto';

export type WupexMode = 'ok' | 'slow_after_charge' | 'slow_before_charge' | 'insufficient' | 'error500' | 'price_review';

export interface FakeOrder {
  id: number; orderName: string; referenceId?: string; orderAmount: number; unitPrice: number;
  sku: string; quantity: number; codes: string[]; failed?: boolean; preorder: boolean;
}

const code = () => randomBytes(6).toString('hex').toUpperCase();

export async function startFakeWupex(opts: { apiKey?: string; slowMs?: number } = {}) {
  const apiKey = opts.apiKey ?? 'test-key';
  const product = (sku: string, i: number, extra: Record<string, unknown> = {}) => {
    const face = Number(sku.match(/(\d+)USD/)![1]);
    return { productId: 100 + i, productCode: sku, productName: sku.replace(/-/g, ' '), price: Math.round(face * 97) / 100, faceValue: face,
             available: 50, enabled: true, discountRate: 3.0, productType: sku.split('-')[0], regionName: sku.split('-')[1] === 'GLOBAL' ? 'Global' : sku.split('-')[1],
             cardType: 'voucher', subType: 0, preorder: true, ...extra };
  };
  const state = {
    balance: 0, credit: 5000,
    orders: [] as FakeOrder[],
    next: [] as WupexMode[],
    nextId: 100,
    products: [
      ...['NETFLIX-USA-50USD', 'NETFLIX-USA-100USD', 'STEAM-USA-50USD', 'PS-USA-50USD', 'GOOGLE-USA-50USD', 'APPLE-USA-50USD',
          'XBOX-USA-50USD', 'SPOTIFY-USA-30USD', 'PUBG-GLOBAL-50USD', 'RAZER-GLOBAL-50USD', 'NETFLIX-TUR-50USD'].map((s, i) => product(s, i)),
      product('GAME-TOPUP-5USD', 50, { cardType: 'topup', subType: 1 })
    ] as any[],
    calls: [] as string[]
  };
  const charge = (usd: number) => { state.balance = Math.round((state.balance - usd) * 100) / 100; };
  const app = Fastify();
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  app.addHook('onRequest', async (req, reply) => {
    state.calls.push(`${req.method} ${req.url}`);
    if (req.headers['x-api-key'] !== apiKey) return reply.status(401).send({ status: false, description: 'Unauthorized' });
    if (!req.headers['accept-language']) return reply.send({ status: false, description: '[BAD_REQUEST] Accept-Language missing' });
  });

  app.get('/api/customer/balance', async () =>
    ({ data: { balance: state.balance, credit: state.credit, creditBalance: state.credit + state.balance }, status: true }));
  app.get('/api/preorder/status', async () => ({ data: { enabled: true, description: 'Pre-order is enabled' }, status: true }));

  app.post('/api/product/merchant/invited/list', async req => {
    const { page = 1, pageSize = 20 } = (req.body ?? {}) as any;
    const all = state.products, size = Math.min(100, pageSize);
    return { pageInfo: { totalPage: Math.ceil(all.length / size), totalCount: all.length, pageSize: size, currentPage: page },
             data: all.slice((page - 1) * size, page * size), status: true };
  });

  app.post('/api/order/pull-codes', async (req, reply) => {
    const q = req.query as { referenceId?: string; allowTakeAll?: string };
    const lines = req.body as Array<{ merchant: string; sku: string; quantity: number }>;
    const mode = state.next.shift() ?? 'ok';
    if (!Array.isArray(lines) || lines.length !== 1 || !lines.every(l => l.merchant && l.sku && l.quantity > 0)) return { status: false, description: '[BAD_REQUEST] invalid body' };
    if (mode === 'error500') return reply.status(500).send({ status: false, description: 'boom' });
    if (mode === 'slow_before_charge') { await sleep(opts.slowMs ?? 800); return reply.status(504).send({}); }
    const dup = q.referenceId ? state.orders.find(o => o.referenceId === q.referenceId) : undefined;
    if (dup) return { data: { requestId: q.referenceId, orderName: dup.orderName, totalAmount: 0, preOrderNo: dup.preorder ? dup.orderName : null,
      statusMessage: 'This referenceId was already completed. Retrieve the codes via api/order/detail.' }, status: true, description: 'ALREADY_COMPLETED' };
    const l = lines[0]!;
    const p = state.products.find(x => x.productCode === l.sku);
    if (!p || mode === 'price_review') return { status: false, description: `[PRICE_REVIEW_REQUIRED] Product ${l.sku}: customer pricing requires review. No new sale authorized.` };
    const short = mode === 'insufficient' || p.available < l.quantity;
    if (short && (!p.preorder || mode === 'insufficient')) {
      return { validateError: { product: [`Insufficient stock. Available: ${p.available}, Requested: ${l.quantity}`] }, status: false, description: 'RequestId:x | Insufficient Stock' };
    }
    const now = q.allowTakeAll === 'true' ? Math.min(p.available, l.quantity) : (short ? 0 : l.quantity);
    p.available -= now;
    const preorder = now < l.quantity;
    const order: FakeOrder = {
      id: ++state.nextId, orderName: (preorder ? 'P' : 'J') + String(state.nextId).padStart(14, '0'), referenceId: q.referenceId,
      unitPrice: p.price, orderAmount: Math.round(p.price * l.quantity * 100) / 100, sku: l.sku, quantity: l.quantity,
      codes: Array.from({ length: now }, code), preorder
    };
    state.orders.push(order); charge(p.price * now);
    if (mode === 'slow_after_charge') await sleep(opts.slowMs ?? 800);   // the client gives up; the order exists anyway
    return { data: { requestId: 'r-' + order.id, orderName: order.orderName, totalAmount: order.orderAmount, deliveredQty: null, awaitingDelivery: false,
      preOrderNo: preorder ? order.orderName : null, preOrderItems: preorder ? 1 : 0,
      statusMessage: preorder ? `Partial delivery: ${now} pins delivered, ${l.quantity - now} pins in pre-order` : 'All items delivered' },
      status: true, ...(preorder ? { description: 'Pre-order created' } : {}) };
  });

  app.get('/api/order/detail', async req => {
    const q = req.query as { orderName?: string; referenceId?: string };
    const o = q.orderName ? state.orders.find(x => x.orderName === q.orderName) : state.orders.find(x => x.referenceId === q.referenceId);
    if (!o) return { status: false, description: 'File not found.' };
    const done = o.codes.length >= o.quantity;
    const statusType = o.failed ? 'Failed' : done ? 'Completed' : o.codes.length ? 'Processing' : 'Pending';
    return { data: { id: o.id, status: statusType === 'Completed' ? 'COMPLATED' : statusType.toUpperCase(), orderName: o.orderName, referenceId: o.referenceId,
      orderAmount: o.orderAmount, statusType, progress: Math.round(100 * o.codes.length / o.quantity),
      totalQuantity: o.quantity, deliveredQuantity: o.codes.length, remainingQuantity: o.failed ? 0 : o.quantity - o.codes.length,
      source: o.preorder && !done ? 'preorder' : 'order',
      orderData: [{ rowId: o.id, productCode: o.sku, productName: o.sku,
        serials: o.codes.map(c => ({ serialNumber: 'SN-' + c.slice(0, 4), serialCode: c, productSku: o.sku, expiry: null, securityCode: '' })) }],
      preOrderItems: o.preorder ? [{ productSku: o.sku, ordered: o.quantity, delivered: o.codes.length, remaining: o.quantity - o.codes.length, supplierStatus: 'PENDING' }] : null },
      status: true };
  });

  /** A Wupex supplier delivers n more codes to an open pre-order. */
  const supply = (orderName: string, n: number) => {
    const o = state.orders.find(x => x.orderName === orderName)!;
    const add = Math.min(n, o.quantity - o.codes.length);
    for (let i = 0; i < add; i++) o.codes.push(code());
    charge(o.unitPrice * add);
  };
  /** Wupex gives up on the rest of a pre-order (charged only for what it delivered). */
  const failPreorder = (orderName: string) => { state.orders.find(x => x.orderName === orderName)!.failed = true; };

  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as { port: number };
  return { url: `http://127.0.0.1:${addr.port}`, apiKey, state, supply, failPreorder, close: () => app.close() };
}
