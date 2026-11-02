---
title: eCards Knowledge Base
tags: [ecards, index]
updated: 2026-11-01
---

# eCards Knowledge Base

**eCards** is a gift card shop that runs as a **mini app inside the M-Pesa app** (Safaricom Ethiopia). Customers buy digital gift cards such as Netflix, PlayStation, Steam, Apple and Google Play. They pay with M-Pesa and get the card code on their phone within seconds.

This vault documents what has been built, how it works, how it is deployed, and what still has to happen before launch.

> [!tip] How to use this vault
> Open the `docs` folder as an Obsidian vault, or as a folder inside your vault. Links like [[System Overview]] jump between notes. Diagrams use Mermaid, which Obsidian draws natively.

---

## Start here

| If you want to… | Read |
|---|---|
| Understand the project in 5 minutes, no tech | [[What is eCards]] |
| Prepare for tomorrow's meeting | [[Meeting Brief]] and [[Questions for Partners]] |
| Show the product to someone | [[Product Walkthrough]] |
| Check everything works (after each update) | [[Acceptance Test Guide]] |
| Know exactly how it is built | [[System Overview]] |
| Know what's done and what's left | [[Status and Roadmap]] |

---

## 1. Plain-language notes (for everyone)
- [[What is eCards]]: the idea, who it's for, how it makes money
- [[The Customer Journey]]: what a customer sees, step by step
- [[The Pieces Explained Simply]]: the app, the admin panel, the server, the database
- [[How Money and Cards Move]]: payments and gift cards, with no jargon
- [[Where It Runs and How It Is Kept Safe]]
- [[What Is Done and What Is Next]]

## 2. Technical notes (for developers and technical partners)
- [[System Overview]]: architecture and component map
- [[Tech Stack]]
- [[Repository Structure]]
- [[Frontend]]: mini app, admin panel, `ecards-api.js`
- [[Backend API]]: every endpoint
- [[Database]]: tables, migrations, conventions
- [[Orders and Fulfilment]]: state machines, stock, pre-orders, provider purchases
- [[Payments – M-Pesa Ethiopia]]: userScopes, payWithMpesa, C2B callbacks
- [[Gift Cards – Wupex]]
- [[Security]]
- [[Infrastructure and Deployment]]
- [[Configuration Reference]]: every environment variable
- [[Testing]]
- [[Operations Runbook]]: day-to-day commands
- [[Status and Roadmap]]
- [[Project Log]]: what was done, in order
- [[Glossary]]

## 3. Guides
- [[Acceptance Test Guide]]: step-by-step checks of the whole system, with what "pass" looks like
- [[Product Walkthrough]]: what to show and say to partners and management
- [[Flow Walkthrough]]: each step explained twice, once technically and once simply

## 4. Meeting material
- [[Meeting Brief]]: a one-page summary for tomorrow
- [[Questions for Partners]]: what we need from Safaricom and Wupex
- [[Decisions Log]]

---

## Key facts at a glance

| | |
|---|---|
| Address | https://ecards.paperless.et/ (admin: `/admin.html`) · test payments until the M-Pesa mini program is registered |
| Server | VPS `91.107.204.59`, app in `/opt/ecards`, systemd service `ecards-api` |
| Database | PostgreSQL 16 in Docker container `ecards-db` (localhost:5433) |
| Code | GitHub `Yesunewh/SE-eCards-MPesa_Miniapp`, branch `backend-api` |
| Backend | Node.js 22 + TypeScript + Fastify + PostgreSQL |
| Payments | M-Pesa Ethiopia H5 mini app: `userScopes` + `payWithMpesa` + C2B callbacks |
| Gift card supplier | Wupex API: **sandbox connected and tested** (merchant `Paperless345`); production keys to come |
| Merchant number to try | `0711885151` (still to confirm with Safaricom: see [[Questions for Partners]]) |
| Tests | 109 automated tests, all passing |

> [!warning] Secrets are never stored in these notes
> API keys, passwords and encryption keys live only on the server in `/opt/ecards/.env` and `/root/ecards-db.pass`. Anything that was shared in chat should be rotated. See [[Security]].
