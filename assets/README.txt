eCards M-Pesa mini app demo: brand images
==========================================

Put your licensed brand files in the three folders here. The app picks them up
when it starts. Anything missing keeps the built-in design, so you can add
files one at a time.

Easier for the demo: open admin.html, go to Brands, open a brand and upload
its logo, card picture and banner there. Pictures uploaded in the admin are
resized automatically and take priority over files in these folders. They are
kept in the browser, so for a real launch put the final files here (or on your
server) instead.

Folders and file names
----------------------
logos/<id>.png     Brand logo. Transparent PNG (or .svg / .webp).
                   Shown on the gift cards and the brand tiles.
cards/<id>.png     Optional full gift card picture (or .jpg / .webp).
                   Replaces the logo design on the card. The dollar value and
                   the Pre-order label are still drawn on top.
                   Best size: 1000 x 640 px (landscape).
banners/<id>.jpg   Home banner picture (or .png / .webp).
                   Best size: 1200 x 1200 px (square). Any brand id works;
                   turn its banner on in admin.html > Home banners.

Brand ids
---------
netflix  steam  xbox  playstation  apple  spotify  googleplay  pubg  razer  cod  ecards

Which logo colour to use
------------------------
Each brand's tile and card share one colour, so one logo file works for both:
  White logo:       netflix, xbox, playstation, spotify, pubg, razer, ecards
  Dark logo:        apple, steam, cod
  Full-colour logo: googleplay

Examples
--------
logos/netflix.png
logos/ecards.png
cards/apple.png
banners/netflix.jpg

Files hosted online
-------------------
If your images are on a server, open index.html, find ASSET_URLS near the top
of the script, and add the links, for example:
  logos: { netflix: 'https://cdn.example.com/netflix-white.png' }

Opening the demo
----------------
Keep index.html, admin.html and this assets folder together.
  index.html   the mini app customers use
  admin.html   the admin panel (orders, pre-orders, stock, catalog, banners, prices)
Open them in a browser, or upload the whole folder to your web host.

The admin panel and the app share the browser's storage, so open both from the
same folder or the same website, in the same browser (Chrome or Edge when
opening the files straight from your computer; any browser on a web host).
Changes saved in the admin show up in an open app tab straight away, and the
"Preview app" button in the admin shows the app next to it.
All data in this demo stays in that browser. A real launch needs a server
that holds orders, stock and codes and talks to M-Pesa.
