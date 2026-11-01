---
title: The Pieces Explained Simply
tags: [ecards, simple]
---

# The Pieces Explained Simply

Back to [[00 Home]] · Technical version: [[System Overview]]

Think of eCards as **a shop**:

| Shop analogy | eCards piece | What it really is |
|---|---|---|
| The shop window and counter | **The mini app** | The screens customers see inside M-Pesa |
| The back office | **The admin panel** | A private website where staff manage everything |
| The shop manager who never sleeps | **The server (backend)** | A program running 24/7 that takes orders, checks payments and hands out codes |
| The safe and the ledger | **The database** | Where every product, order, payment and code is stored, codes locked (encrypted) |
| The cashier | **M-Pesa** | Takes the customer's money and tells us it arrived |
| The wholesaler | **Wupex** | Sells us gift card codes on demand |
| The building | **The VPS** | A rented computer on the internet where the server and database live |
| The street address | **ecards.paperless.et** | The web address M-Pesa opens |

## The mini app (customer side)
It is a web page designed for phones. When opened inside M-Pesa, it can ask M-Pesa for the customer's name and number, and open the M-Pesa payment screen. It shows the catalogue, cart, orders and codes, support chat, wishlist and language settings.

## The admin panel (staff side)
Staff log in with email and password. They can:
- see sales and orders, and help customers;
- **add stock**, by pasting codes bought in bulk;
- set **prices** (exchange rate), turn brands on or off, and design the home screen;
- connect suppliers (Wupex) and choose which supplier fulfils which card;
- answer **support tickets**;
- see the **audit log**: who changed what.

## The server (the "brain")
Every time something happens, the server decides what to do:
- a customer orders, so it calculates the price itself (the phone can't cheat);
- M-Pesa says "paid", so it finds a code: **first from our own stock**, then **buys from Wupex**, and if neither is possible, it keeps a **pre-order**;
- nobody paid within 15 minutes, so the order expires;
- new stock arrives, so it fills waiting pre-orders, oldest first.

## The database (the "memory")
Everything is stored here. Gift codes are stored **encrypted**: even someone who copied the database couldn't read them without a separate secret key.

Next: [[How Money and Cards Move]]
