import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { createContext } from '../src/context.js';
import { buildApp } from '../src/http/app.js';

const root = path.resolve(import.meta.dirname, '../..');   // the repo: index.html, admin.html, assets/
const ctx = createContext({ ...loadConfig(), STATIC_DIR: root });
let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(ctx); });
afterAll(async () => { await app.close(); await ctx.db.end(); });
const get = (url: string) => app.inject({ method: 'GET', url });

describe('serving the mini app and admin panel', () => {
  it('serves the pages and assets', async () => {
    for (const u of ['/', '/index.html', '/admin.html', '/web.html', '/assets/ecards-api.js', '/assets/logos/netflix.png']) {
      expect((await get(u)).statusCode, u).toBe(200);
    }
    expect((await get('/')).headers['content-type']).toMatch(/text\/html/);
    expect((await get('/assets/ecards-api.js')).headers['cache-control']).toBe('no-cache');
  });

  it('serves nothing outside the allow-list', async () => {
    for (const u of ['/server/.env', '/server/package.json', '/.git/config', '/assets/../server/.env', '/assets/%2e%2e/server/.env',
                     '/assets/..%2fserver%2f.env', '/assets/README.txt/../../server/.env', '/site-builder/build_site.py']) {
      expect((await get(u)).statusCode, u).toBe(404);
    }
  });

  it('the API still answers next to the pages', async () => {
    expect((await get('/v1/catalog')).statusCode).toBe(200);
  });
});
