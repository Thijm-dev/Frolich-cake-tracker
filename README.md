# 🍰 Frolich Cake & Fruit Tracker

A simple **food expiry tracker for the cafe**. Use it for the things we unwrap or put out ourselves: **cakes** once they're opened and **fruit** once it's delivered. It shows everyone when each item went out and when it has to be thrown away.

Pre-packaged stock (sandwiches, beer, etc.) already has dates printed on it, so it's not tracked here.

## The problem

- Once a cake comes out of its packaging, the only record of when it was opened is a day dot. Day dots fall off, get covered, or people forget which colour is which day.
- Fruit deliveries arrive on different days. It's hard to remember *when* a batch came in and *when* it was put out.
- When someone asks "is this cake still in date?", there's no single place to check. You have to ask whoever opened it.

## What it does

- **Log it in a few seconds.** Tap **＋ Log**, pick the item (e.g. *Carrot cake*, *Bananas*) and the throw-away date fills in automatically from its shelf life. You can add a **photo** from the phone camera.
  - **Fruit:** logs the **delivery** time. Tap **Put out now** later when it goes on the counter.
  - **Cakes:** logs when it was **opened / put out**.
- **"Out now" board.** Everything currently out, colour-coded:
  - 🚨 **Bin now**: past its time
  - ⏰ **Last day**: bin at close today
  - ✅ **In date**: how many days are left
- **Search.** Type "carrot" to see straight away if it's still in date.
- **Day dot colours** (Mon blue, Tue yellow, Wed red, Thu brown, Fri green, Sat orange, Sun black) next to each date, so the app matches the labels on the food.
- **Binned / Used up buttons.** Takes the item off the board and keeps a **history**, including a 7-day count of how much was binned vs. used up (useful for spotting waste).
- **Shelf lives tab.** Change how many days each cake or fruit lasts, or add new items. **The day it's opened counts as day 1**, so a 3-day cake opened on Monday is binned at close on Wednesday. The throw-away time can always be edited by hand.
- **Shared by all staff.** Everyone opens the same link on their phone or the till PC and sees the same list. It refreshes every minute and can be added to the home screen like an app.
- **Optional staff PIN** so only staff can see or change it. Each person's name is saved with what they log or bin.

## Try it now: GitHub Pages

The app is published at **https://thijm-dev.github.io/Frolich-cake-tracker/**. It's redeployed automatically on every push (see `.github/workflows/pages.yml`).

> ⚠️ **GitHub Pages only hosts files and can't run the server**, so in this mode each phone keeps its **own** list in its browser. Other staff won't see your logs, and clearing the browser's data wipes it. That's fine for trying it out. For the real thing, run the server (below) somewhere, then on each phone go to **Shelf lives → Shared server**, paste its address and tap **Connect**. Everyone then shares one list, and the Pages link keeps working as the front end.

## Running the shared server

Needs [Node.js](https://nodejs.org) 18 or newer. There are **no other dependencies**.

```bash
CAFE_PIN=1234 npm start      # then open http://localhost:3000
```

| Setting    | Default  | What it does                                   |
|------------|----------|------------------------------------------------|
| `PORT`     | `3000`   | Port to listen on                              |
| `CAFE_PIN` | *(none)* | Staff PIN. Leave unset for no PIN              |
| `DATA_DIR` | `./data` | Where the database (`db.json`) and photos live |

### Where to host it

All staff need to reach **the same running copy**, so it has to live somewhere permanent:

1. **On a computer in the cafe** (back-office PC, Raspberry Pi). Staff phones on the cafe Wi-Fi open `http://<that-computer's-IP>:3000`. Free and simple.
2. **In the cloud** so it works from anywhere. Use any host that runs Node or Docker **with a persistent disk** (e.g. Render, Railway or Fly.io). Mount the disk at `/data`:
   ```bash
   docker build -t cake-tracker .
   docker run -p 3000:3000 -e CAFE_PIN=1234 -v cake-data:/data cake-tracker
   ```
   Always set a `CAFE_PIN` when it's on the public internet.

**Back up** by copying the `data/` folder.

## Development

```bash
npm test     # API tests (Node's built-in test runner)
```

- `server.js`: tiny HTTP server plus JSON API (`/api/items`, `/api/presets`)
- `public/`: the web app (plain HTML/CSS/JS, installable as a PWA)

## Ideas for later

- Read the printed date off a photo automatically (OCR)
- A morning "bin these today" notification
- Weekly waste report by item
