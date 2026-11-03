# eCards: notes for Claude Code

Gift cards sold inside the M-Pesa Ethiopia app (H5 mini app). It has a server (`server/`), a mini app (`index.html`), an admin panel (`admin.html`) and a shared API client (`assets/ecards-api.js`).

**Start here:** read `docs/session/Session Handoff.md`. It covers the current state, the agreed rules, the pending server steps and the open work. The full earlier conversation, with secrets removed, is in `docs/session/Conversation History.md`. The knowledge base (Obsidian) is `docs/`; start at `docs/00 Home.md`.

Rules:
- Work on branch `backend-api`. Commit as `Yesunewh <63301786+Yesunewh@users.noreply.github.com>`, with no Claude co-author or session trailers. No pull request unless asked.
- Production standard: no demo, sample or preview texts or features. Sandbox credentials are fine.
- The server `91.107.204.59` is shared with Odoo and other apps. Change nothing outside `/opt/ecards`, `~/ecards-src`, the `ecards-db` container, the `ecards-api` service and the nginx site `ecards.paperless.et`, and ask first before anything else.
- Never put secrets in git or docs. They live in `/opt/ecards/.env` and `/root/ecards-db.pass`.
- Keep `docs/` up to date with every change. Run `cd server && npm test` (against a local `ecards_test` database, never the live one) before committing.
