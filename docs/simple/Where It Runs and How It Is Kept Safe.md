---
title: Where It Runs and How It Is Kept Safe
tags: [ecards, simple]
---

# Where It Runs and How It Is Kept Safe

Back to [[00 Home]] · Technical: [[Infrastructure and Deployment]] · [[Security]]

## Where it runs
- On our **rented server (VPS)** at `91.107.204.59`. The same machine runs Odoo and other company systems.
- eCards was installed in its **own separate space**: its own user, its own copy of Node.js, its own database container, and its own limits (at most 512 MB of memory and half a processor). It can't slow down or break the other systems.
- People reach it at **https://ecards.paperless.et**. The admin panel is at **/admin.html**.
- If an update fails, it **switches back to the previous version automatically**.

## How it's kept safe
| Risk | Protection |
|---|---|
| Someone steals the database | Codes are **encrypted**; the key is kept separately |
| A staff member misuses codes | Staff see only the last 4 characters; viewing a full code is **logged** |
| Someone guesses staff passwords | Account **locks for 15 minutes** after 5 wrong tries |
| A fake "payment received" message | The secret address plus a check of order number **and** amount |
| Someone pretends to be another customer | Codes show **only on the phone that bought them** |
| The phone sends a fake price | The **server** calculates every price |
| Too many requests (abuse) | Rate limits on login, ordering and paying |

## Things to keep doing
- **Daily backups** of the database and a separate copy of the secret keys.
- **Change passwords and keys** that were shared in chats: the Safaricom test keys and the old server password.
- Use **new production keys** at launch.

Next: [[What Is Done and What Is Next]]
