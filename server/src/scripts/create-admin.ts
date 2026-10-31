/**
 * Creates an admin user.
 *   npm run admin:create -- owner@paperless.et "Full Name" owner
 * The password is read from ADMIN_PASSWORD, so it never lands in shell history.
 */
import { createPool } from '../db/pool.js';
import { createAdmin, type Role } from '../services/admin.js';

const [email, name, role = 'owner'] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD ?? '';
if (!email || !name || !['owner', 'admin', 'support', 'viewer'].includes(role)) {
  console.error('usage: ADMIN_PASSWORD=… npm run admin:create -- <email> "<name>" [owner|admin|support|viewer]');
  process.exit(1);
}
const db = createPool(process.env.DATABASE_URL ?? '');
try {
  const a = await createAdmin(db, email, name, password, role as Role);
  console.log(`created ${a.role} ${a.email}`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
