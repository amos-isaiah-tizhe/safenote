# SafeNote

**Send secrets that self-destruct. End-to-end encrypted, burn-after-read notes.**

Live site → [Netlify](https://safenoteonexp.netlify.app/)

---

## About This Project

SafeNote is my second project while learning JavaScript, the first was a weather app, Yoh can find it in my git profile.

**Author:** Amos Isaiah Tizhe  
**Brand:** OneXportal  

| Platform | Link |
|---|---|
| GitHub | [@amosisaiahtizhe](https://github.com/amosisaiahtizhe) |
| Twitter / X | [@isaiahamostizhe](https://twitter.com/isaiahamostizhe) |
| Instagram | [@amosisaiahtizhe](https://instagram.com/amosisaiahtizhe) |
| LinkedIn | [@amosisaiahtizhe](https://linkedin.com/in/amosisaiahtizhe) |
| TikTok | [@amosisaiahtizhe](https://tiktok.com/@amosisaiahtizhe) |
| Facebook | [@amosisaiahtizhe](https://facebook.com/amosisaiahtizhe) |

---

## What it does

SafeNote lets you write a private message, encrypt it in your browser, and get a one-time link you can share. The recipient opens the link, the message is decrypted in *their* browser, and then it's permanently deleted from the database. Nobody — not even the server — can read it.

**Key features:**
- AES-256 encryption done entirely in the browser (Web Crypto API)
- Optional password protection
- Burn-after-reading (note is deleted the moment it's viewed)
- Multi-read mode with a max view count limit
- Expiry time (1 hour to 7 days)
- Rate limiting (5 notes per day per IP)
- Zero server-side code — runs 100% as static files on GitHub Pages

---

## How it works (simple explanation)

1. You type a message → JavaScript encrypts it → encrypted gibberish is saved to Supabase (a cloud database)
2. Supabase gives it a unique ID → we turn that into a link like `read.html?id=abc123`
3. You share that link → recipient opens it → JavaScript fetches the encrypted gibberish from Supabase
4. JavaScript decrypts it in the recipient's browser → they read it → it's deleted forever

**The server never sees the real message, only encrypted data.**

---

## Tech stack

| Layer | Tool |
|---|---|
| Frontend | HTML, CSS, Vanilla JavaScript (ES Modules) |
| Encryption | Web Crypto API (AES-GCM, 256-bit) |
| Database | [Supabase](https://supabase.com) (free tier) |
| File Hosting | GitHub Pages (static files only — no backend needed) |

---

## Known Issues & Fixes

### GitHub Pages: `read.html?id=` URL not working

**Problem:** When a note link is shared as `/read?id=...` (without `.html`), GitHub Pages can't find the file and shows a 404. The `404.html` redirect handler was stripping the `/subfolder/` path from the URL, sending users to the wrong location.

**Root cause:** The redirect used a hardcoded `/` root path:
```js
// ❌ Before — breaks when site is deployed in a subfolder (e.g. /safenote/)
window.location.replace("/read.html" + search);
```

**Fix applied in `404.html`:**
```js
// ✅ After — dynamically preserves the subfolder path
const base = window.location.pathname.replace(/\/read\/?$/, "");
window.location.replace(base + "/read.html" + search);
```

This ensures note links work correctly whether the site is deployed at the root or inside a subfolder like `https://username.github.io/safenote/`.

---

## Setup (if you want to run your own copy)

### 1. Create a Supabase project

Go to [supabase.com](https://supabase.com), create a free project, and run the SQL below in the Supabase SQL editor:

```sql
-- Notes table
create table notes (
  id            uuid primary key default gen_random_uuid(),
  message       text not null,
  expires_at    timestamptz not null,
  has_password  boolean default false,
  created_by_ip text,
  burn_after_reading boolean default true,
  view_count    integer default 0,
  max_views     integer,
  created_at    timestamptz default now()
);

-- Audit log table
create table note_access_log (
  id         bigserial primary key,
  note_id    uuid references notes(id) on delete set null,
  action     text check (action in ('viewed', 'deleted', 'expired')),
  logged_at  timestamptz default now()
);

-- Row Level Security: allow anonymous inserts and reads
alter table notes enable row level security;
create policy "Allow anon insert" on notes for insert to anon with check (true);
create policy "Allow anon select" on notes for select to anon using (true);
create policy "Allow anon delete" on notes for delete to anon using (true);
create policy "Allow anon update" on notes for update to anon using (true);

alter table note_access_log enable row level security;
create policy "Allow anon insert log" on note_access_log for insert to anon with check (true);
```

### 2. Add your Supabase credentials

Open `assets/js/config.js` and replace the values with your own:

```js
export const SUPABASE_URL = "https://your-project.supabase.co";
export const SUPABASE_KEY = "your-anon-public-key";
```

> The anon key is safe to commit — it's public by design. Never commit your **service_role** key.

### 3. Deploy to GitHub Pages

- Push this folder to a GitHub repository
- Go to **Settings → Pages → Source** and set it to `main` branch, root `/`
- Your site will be live at `https://yourusername.github.io/repo-name`

---

## File structure

```
safenote/
├── index.html          ← Create note page
├── read.html           ← Read/decrypt note page
├── 404.html            ← Redirect handler for /read?id= links (bug fixed)
├── assets/
│   ├── css/
│   │   └── styles.css
│   └── js/
│       ├── app.js      ← Supabase client setup
│       ├── config.js   ← Your Supabase URL and key go here
│       ├── create.js   ← Create note logic
│       ├── read.js     ← Read/decrypt note logic
│       ├── crypto.js   ← AES-256 encryption/decryption
│       └── toggle.js   ← Dark/light theme toggle
└── README.md
```

---

## Why no server?

GitHub Pages only serves static files — HTML, CSS, and JavaScript. It cannot run Node.js or Express. SafeNote doesn't need a server because:

- Encryption and decryption happen in JavaScript, inside your browser
- The database (Supabase) is a cloud service with its own API — JavaScript talks to it directly

This makes the app simpler, cheaper (free), and more trustworthy — there's no server in the middle that could log your messages.

---

*Built by [Amos Isaiah Tizhe](https://github.com/amosisaiahtizhe) — OneXportal*
