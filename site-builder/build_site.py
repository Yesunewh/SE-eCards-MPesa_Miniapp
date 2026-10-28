#!/usr/bin/env python3
"""
eCards web store: pre-rendered, search-engine and AI-ready site builder.

Takes the single-file web store (web.html) and writes a static website where every page has its own
clean address in every language, already rendered to HTML (no JavaScript needed to read it), with:
  - titles, descriptions, canonical and hreflang links, Open Graph tags
  - structured data (JSON-LD): Organization, WebSite + search, Product + Offer, BreadcrumbList, FAQPage, ItemList
  - sitemap.xml with language alternates, robots.txt (AI crawlers allowed), 404 page
  - llms.txt and llms-full.txt for AI assistants, a Markdown copy of every page (index.md)
  - catalog.json (every card, price and availability) and a Google Merchant product feed
  - a 1200x630 share picture per brand, self-hosted fonts

The same code renders the pages in the browser, so what search engines read is what customers see.
Run it again whenever prices, stock or brands change (for example every night).

Usage:
  pip install playwright && playwright install chromium     (once)
  python3 build_site.py                                      (reads site.config.json next to this file)
  python3 build_site.py --site-url https://www.your-domain.et --out ../site
"""
import argparse, asyncio, json, re, shutil, sys
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
ORIGIN = 'http://ecards.build'   # a private address used only while rendering

FONTS = [  # (family, file, weight, unicode-range)
    ('Figtree', 'figtree-latin-400-normal.woff2', 400, 'latin'), ('Figtree', 'figtree-latin-600-normal.woff2', 600, 'latin'),
    ('Figtree', 'figtree-latin-700-normal.woff2', 700, 'latin'), ('Figtree', 'figtree-latin-800-normal.woff2', 800, 'latin'),
    ('Noto Sans Ethiopic', 'noto-sans-ethiopic-ethiopic-400-normal.woff2', 400, 'ethiopic'),
    ('Noto Sans Ethiopic', 'noto-sans-ethiopic-ethiopic-600-normal.woff2', 600, 'ethiopic'),
    ('Noto Sans Ethiopic', 'noto-sans-ethiopic-ethiopic-700-normal.woff2', 700, 'ethiopic'),
]
RANGES = {
    'latin': 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
    'ethiopic': 'U+030E,U+1200-1399,U+2D80-2DDE,U+AB01-AB2E,U+1E7E0-1E7E6,U+1E7E8-1E7EB,U+1E7ED-1E7EE,U+1E7F0-1E7FE',
}
AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User',
           'Google-Extended', 'Applebot', 'Applebot-Extended', 'Bingbot', 'CCBot', 'meta-externalagent', 'DuckAssistBot']
FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e2403c"/><stop offset="1" stop-color="#7a1013"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="url(#g)"/><text x="32" y="43" font-family="Arial,Helvetica,sans-serif" font-size="34" font-weight="800" fill="#fff" text-anchor="middle">e</text></svg>'


def shell(site_url):
    pre = ''.join(f'<link rel="preload" href="/assets/fonts/{f}" as="font" type="font/woff2" crossorigin>' for f in ('figtree-latin-400-normal.woff2', 'figtree-latin-800-normal.woff2'))
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#dce4fb">
<meta name="ec-site" content="{site_url}">
<meta name="ec-build" content="1">
<title>eCards</title>
{pre}
<link rel="stylesheet" href="/assets/app.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/og/icon-180.png">
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="shellA" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#f1f3f8"/><stop offset="1" stop-color="#e1e4ef"/></linearGradient>
    <linearGradient id="shellB" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="#eef0f8"/><stop offset="1" stop-color="#d9dcec"/></linearGradient>
    <linearGradient id="holeG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a8afd8"/><stop offset="1" stop-color="#c1c6e6"/></linearGradient>
    <clipPath id="shellClip"><path id="shellClipPath" d=""/></clipPath>
  </defs>
</svg>
<header class="top" id="top"></header>
<main id="main" tabindex="-1"></main>
<footer id="foot"></footer>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script src="/assets/app.js" defer></script>
</body>
</html>
'''


SERIALIZE = r'''(path) => {
  const d = document.documentElement.cloneNode(true);
  d.querySelectorAll('.mwrap').forEach(x => x.remove());
  d.querySelectorAll('[inert]').forEach(x => x.removeAttribute('inert'));
  const t = d.querySelector('#toast'); if (t) { t.className = 'toast'; t.textContent = ''; }
  d.querySelectorAll('meta[name="ec-route"]').forEach(x => x.remove());
  const m = document.createElement('meta'); m.setAttribute('name', 'ec-route'); m.setAttribute('content', path);
  d.querySelector('head').insertBefore(m, d.querySelector('head title'));
  return '<!doctype html>\n' + d.outerHTML;
}'''


def robots(site_url):
    rules = ['Allow: /', 'Disallow: /cart/', 'Disallow: /orders/', 'Disallow: /*/cart/', 'Disallow: /*/orders/', 'Disallow: /*?q=']
    lines = ['# eCards: search engines and AI assistants are welcome to read the catalog, prices and help pages.',
             '# Carts and order pages are private and not indexed.', '', 'User-agent: *', *rules, '']
    lines += ['# AI assistants and AI search', *[f'User-agent: {b}' for b in AI_BOTS], *rules, '',
              f'Sitemap: {site_url}/sitemap.xml', '', f'# For AI assistants: {site_url}/llms.txt', '']
    return '\n'.join(lines)


HEADERS = '''# Netlify / Cloudflare Pages: caching and content types. Other hosts: set the same headers in their config.
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/*.md
  Content-Type: text/markdown; charset=utf-8
  X-Robots-Tag: noindex
/llms.txt
  Content-Type: text/plain; charset=utf-8
/llms-full.txt
  Content-Type: text/plain; charset=utf-8
/catalog.json
  Cache-Control: public, max-age=900
/*/cart/*
  X-Robots-Tag: noindex
/*/orders/*
  X-Robots-Tag: noindex
'''


async def build(web, out, site_url, fonts_dir):
    from playwright.async_api import async_playwright
    src = web.read_text(encoding='utf-8')
    css = re.search(r'<style>(.*?)</style>', src, re.S).group(1)
    js = re.search(r'<script>(.*?)</script>', src, re.S).group(1)
    if out.exists():
        shutil.rmtree(out)
    (out / 'assets' / 'fonts').mkdir(parents=True)
    (out / 'assets' / 'og').mkdir(parents=True)
    faces = ''.join(f"@font-face{{font-family:'{fam}';font-style:normal;font-weight:{w};font-display:swap;src:url(/assets/fonts/{f}) format('woff2');unicode-range:{RANGES[r]}}}\n" for fam, f, w, r in FONTS)
    for _, f, _, _ in FONTS:
        shutil.copy(fonts_dir / f, out / 'assets' / 'fonts' / f)
    lic = fonts_dir / 'LICENSE.txt'
    if lic.exists():
        shutil.copy(lic, out / 'assets' / 'fonts' / 'LICENSE.txt')
    (out / 'assets' / 'app.css').write_text(faces + css, encoding='utf-8')
    (out / 'assets' / 'app.js').write_text(js, encoding='utf-8')
    (out / 'favicon.svg').write_text(FAVICON, encoding='utf-8')
    html_shell = shell(site_url)

    async def serve(route):
        path = urlparse(route.request.url).path
        f = out / path.lstrip('/')
        if path.startswith('/assets/') and f.is_file():
            ctype = {'.css': 'text/css', '.js': 'application/javascript', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg'}.get(f.suffix, 'application/octet-stream')
            await route.fulfill(body=f.read_bytes(), content_type=ctype)
        elif path == '/favicon.svg':
            await route.fulfill(body=FAVICON, content_type='image/svg+xml')
        else:
            await route.fulfill(body=html_shell, content_type='text/html')

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={'width': 1280, 'height': 900})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.route(f'{ORIGIN}/**', serve)
        await page.route(re.compile(r'^https?://(?!ecards\.build).*'), lambda r: r.abort())   # nothing leaves the machine while building
        await page.goto(ORIGIN + '/')
        await page.wait_for_function('window.__SEO')
        await page.evaluate('document.fonts.ready')
        pages = await page.evaluate('window.__SEO.pages()')
        n_html = n_md = 0
        for pg in pages:
            await page.evaluate('(p) => window.__SEO.render(p)', pg['path'])
            html = await page.evaluate(SERIALIZE, pg['path'])
            target = out / pg['path'].lstrip('/') / 'index.html'
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(html, encoding='utf-8'); n_html += 1
            if pg.get('md'):
                (target.parent / 'index.md').write_text(await page.evaluate('(p) => window.__SEO.markdown(p)', pg['path']), encoding='utf-8'); n_md += 1
        await page.evaluate('(p) => window.__SEO.render(p)', '/page-not-found/')
        (out / '404.html').write_text(await page.evaluate(SERIALIZE, '/page-not-found/'), encoding='utf-8')
        (out / 'sitemap.xml').write_text(await page.evaluate('window.__SEO.sitemap()'), encoding='utf-8')
        (out / 'catalog.json').write_text(await page.evaluate('window.__SEO.catalog()'), encoding='utf-8')
        (out / 'feeds').mkdir()
        (out / 'feeds' / 'google-merchant.xml').write_text(await page.evaluate('window.__SEO.merchantFeed()'), encoding='utf-8')
        llms = await page.evaluate('window.__SEO.llms()')
        (out / 'llms.txt').write_text(llms['short'], encoding='utf-8')
        (out / 'llms-full.txt').write_text(llms['full'], encoding='utf-8')
        # share pictures: one per brand plus a default one
        brand_ids = await page.evaluate("Object.keys(JSON.parse(window.__SEO.catalog()).items.reduce((a, it) => (a[it.id.replace(/-\\d+$/, '')] = 1, a), {}))")
        await page.set_viewport_size({'width': 1200, 'height': 630})
        for bid in ['default'] + brand_ids:
            await page.evaluate('(id) => window.__SEO.og(id)', bid)
            await page.evaluate('document.fonts.ready')
            await page.wait_for_timeout(120)
            await page.screenshot(path=str(out / 'assets' / 'og' / f'{bid}.jpg'), type='jpeg', quality=86, clip={'x': 0, 'y': 0, 'width': 1200, 'height': 630})
        await page.set_viewport_size({'width': 180, 'height': 180})
        await page.set_content(f'<body style="margin:0">{FAVICON.replace("<svg ", "<svg width=180 height=180 ")}</body>')
        await page.screenshot(path=str(out / 'assets' / 'og' / 'icon-180.png'), clip={'x': 0, 'y': 0, 'width': 180, 'height': 180})
        await page.set_viewport_size({'width': 512, 'height': 512})
        await page.set_content(f'<body style="margin:0">{FAVICON.replace("<svg ", "<svg width=512 height=512 ")}</body>')
        await page.screenshot(path=str(out / 'assets' / 'og' / 'logo-512.png'), clip={'x': 0, 'y': 0, 'width': 512, 'height': 512})
        await browser.close()
    (out / 'robots.txt').write_text(robots(site_url), encoding='utf-8')
    (out / '_headers').write_text(HEADERS, encoding='utf-8')
    if errors:
        print('Page errors while building:', *errors, sep='\n  ')
        sys.exit(1)
    print(f'Built {n_html} pages, {n_md} Markdown copies, {len(brand_ids) + 1} share pictures -> {out}')


def main():
    cfg_file = HERE / 'site.config.json'
    cfg = json.loads(cfg_file.read_text()) if cfg_file.exists() else {}
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--web', default=str(HERE.parent / 'web.html'), help='the single-file web store')
    ap.add_argument('--out', default=str(HERE.parent / 'site'), help='where to write the website')
    ap.add_argument('--site-url', default=cfg.get('siteUrl', 'https://ecards.example.com'), help='public address, no trailing slash')
    ap.add_argument('--fonts', default=str(HERE / 'fonts'))
    a = ap.parse_args()
    asyncio.run(build(Path(a.web), Path(a.out), a.site_url.rstrip('/'), Path(a.fonts)))


if __name__ == '__main__':
    main()
