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

## On GitHub Pages

The app lives at **https://thijm-dev.github.io/Frolich-cake-tracker/** and is redeployed automatically on every push (see `.github/workflows/pages.yml`).

- **Until Supabase is set up** (`public/config.js` is empty), it runs as a **demo**: sample cakes and fruit, saved on that device only.
- **Once Supabase is set up**, the same link becomes the **real shared list**. Staff log in once per phone with the shared staff login, and changes show up on every phone straight away.
- The demo is still available at **…/Frolich-cake-tracker/?demo**.

## Shared list with Supabase (free)

[Supabase](https://supabase.com) is a free online database. The free plan is plenty for one cafe. Free projects pause after about a week with **no** use, and daily logging keeps it awake.

1. **Create a project.** Sign up at supabase.com (you can sign in with GitHub). Click **New project**:
   - **Name:** `frolich-cake-tracker`
   - **Database password:** pick one and save it somewhere. The app doesn't need it.
   - **Region:** closest to the cafe, e.g. *London*

   Then wait a minute or two while it sets up.
2. **Create the staff login.** Go to **Authentication → Users → Add user → Create new user**:
   - Enter an email (e.g. the cafe's email) and a password that staff will type once on each phone.
   - Tick **Auto Confirm User**.
3. **Stop strangers signing up** (recommended). Go to **Authentication → Sign In / Providers** and turn **off** "Allow new users to sign up".
4. **Create the database.** Go to **SQL Editor → New query**:
   - Paste in everything from [`supabase/setup.sql`](supabase/setup.sql).
   - Change `staff@example.com` on the **last lines** to the email from step 2, in lower case.
   - Click **Run**. You should see *"Success. No rows returned"*.
5. **Connect the app.** Open the **Connect** button (or **Project Settings → API Keys**) and copy:
   - the **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - the **publishable** key (starts `sb_publishable_…`), or on older projects the **anon public** key

   Put them in [`public/config.js`](public/config.js) together with the staff email, then push. GitHub Pages updates in about a minute.

**Never** put the **secret / service_role key** or the **database password** in the app. The publishable key is designed to be public: the database rules from step 4 only let the staff login see or change anything.

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
