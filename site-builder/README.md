# eCards web store: SEO and AI-ready site

`../site/` is the web store as a ready-to-host static website. It is generated from `../web.html`
by `build_site.py`, so the pages search engines read are exactly what customers see.

## What is in it

| Item | Where | Why |
|---|---|---|
| One page per brand, per card value and per category, in 5 languages | `/netflix-gift-card/`, `/am/netflix-gift-card/50-usd/`, `/so/gift-cards/gaming/` | Ranks for searches like "Netflix gift card Ethiopia" or "PlayStation $50 price in Birr" |
| Pre-rendered HTML | every `index.html` | Readable without JavaScript, fast first paint |
| Title, description, canonical, hreflang, Open Graph | `<head>` of every page | Right language in results, no duplicate pages, good link previews |
| Structured data (JSON-LD) | `<script id="ec-ld">` | Product + Offer (price in ETB, in stock or pre-order, no-return policy), BreadcrumbList, FAQPage, ItemList, Organization, WebSite search |
| Price table and questions per brand | brand and value pages | Clear answers for search snippets and AI assistants |
| `sitemap.xml` | site root | All indexable pages with language alternates |
| `robots.txt` | site root | Lets search engines and AI crawlers in, keeps carts and orders out |
| `llms.txt`, `llms-full.txt` | site root | Summary and full content for AI assistants (llmstxt.org format) |
| `index.md` next to each page | e.g. `/netflix-gift-card/index.md` | Clean Markdown copy for AI tools |
| `catalog.json` | site root | Every card, price, VAT and availability in one file |
| `feeds/google-merchant.xml` | | Product feed for Google Merchant Center, if you use it |
| Share pictures | `assets/og/*.jpg` | 1200×630 preview per brand for social media and chat apps |
| Self-hosted fonts | `assets/fonts/` | No third-party font requests, faster pages |
| `_headers` | site root | Caching and content types on Netlify or Cloudflare Pages |
| `404.html` | site root | "Not found" page that is not indexed |

## Publish it

1. Set your real address in `site.config.json` (for example `https://www.ecards.et`), then rebuild.
   The demo build uses the placeholder `https://ecards.example.com`.
2. Upload the `site` folder to any static host (Netlify, Cloudflare Pages, S3 + CloudFront, Nginx).
   Folders contain `index.html`, so clean addresses work everywhere. Serve `404.html` for missing pages.
3. Add the site to Google Search Console and Bing Webmaster Tools and submit `sitemap.xml`.
4. Rebuild whenever prices, stock or brands change (a nightly job is enough), so prices,
   availability and structured data stay accurate. In the live system, the server can render the
   same pages on request instead.

## Rebuild

```
pip install playwright && playwright install chromium
python3 build_site.py                 # or: --site-url https://www.your-domain.et --out ../site
```

## Try it locally

```
cd ../site && python3 -m http.server 8000      # then open http://localhost:8000
```
Opening `site/…/index.html` files directly also works for reading pages; buying needs the web server
(or use `web.html`, the single-file demo).

## Notes

- Translations were written for the demo; have native speakers review them before launch.
- Google shows FAQ rich results only for a small set of sites, but the FAQ markup still helps other
  search engines and AI assistants understand the page.
- Google Shopping availability in Ethiopia should be checked before relying on the Merchant feed.
