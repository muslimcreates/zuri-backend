# Zuri Express — Backend API

*"For Kenyans, By Kenyans"* — the backend for a storefront where Kenyans
living in Türkiye can buy Kenyan groceries, spices, fabric and more. This is
a standalone REST API (Node.js + Express + PostgreSQL) with no frontend —
the plan is to build a React app against it next.

Single admin-managed store (not a multi-vendor marketplace): Zuri Express
stocks/sources the goods; admin-only endpoints manage the catalog and
orders.

## Stack

- **Node.js + Express 5 + TypeScript**
- **PostgreSQL + Prisma** for the database and migrations
- **JWT session cookie** (`jsonwebtoken` + an httpOnly cookie) for auth —
  no external auth library, kept small and auditable
- **Google Sign-In** as an additional login method alongside email/password
  (see below) — the frontend gets a token straight from Google, the backend
  verifies it and issues the same session cookie
- **Zod** for request validation
- **CORS configured for a separate frontend** (`credentials: true`, exact
  origin) — this API is meant to be called from a React app on a different
  port/domain, not to serve HTML itself

## Why no payment gateway yet

There's no registered Turkish company yet. The two realistic payment
processors for a Turkey-based store — **iyzico** and **PayTR** — both
require a trade registry gazette, tax ID and company IBAN to open an
account, so a live integration isn't possible until that exists.

Checkout (`POST /api/orders`) collects a **manual payment method** (bank
transfer or cash on delivery) instead. Orders start as `PENDING_PAYMENT`;
the admin confirms funds arrived and updates the status via
`PATCH /api/admin/orders/:id`.

When the company is registered, implement the real integration in
`src/lib/payments.ts` (see the `PaymentProvider` interface) — nothing in
the order model or routes needs to change.

## 1. Set up a Postgres database

**Recommended: [Supabase](https://supabase.com)** — a hosted Postgres, free
for a project this size, with no local install needed. This is what the
project currently uses.

1. Sign up at supabase.com and create a new project (name it e.g.
   `zuri-express`). Set a database password when prompted — **write it
   down**, you'll need it in a moment. Pick a region close to your users
   (e.g. an EU region, for Türkiye).
2. Wait a minute or two for the project to finish provisioning.
3. Click the **Connect** button on the project dashboard, and copy the
   **Session pooler** connection string (not Transaction pooler — session
   mode behaves like a normal persistent connection, which is what this
   Express server wants; transaction mode is for serverless functions and
   can break Prisma migrations).
4. Paste it into `.env` as `DATABASE_URL`, replacing `[YOUR-PASSWORD]` in
   the string with the password from step 1.

That's it — skip to step 2 below.

<details>
<summary>Alternative: install Postgres locally instead</summary>

Only do this if you specifically want a fully offline/local setup.

**macOS** (using [Homebrew](https://brew.sh)):
```bash
brew install postgresql@16
brew services start postgresql@16
```

**Windows**: download the installer from
[postgresql.org/download/windows](https://www.postgresql.org/download/windows/)
and run it — it sets up the service and a `psql` command-line tool for you.
Remember the password you set for the `postgres` user during install.

**Linux (Debian/Ubuntu)**:
```bash
sudo apt update && sudo apt install postgresql
sudo service postgresql start
```

Once it's installed and running, create the database and set a password
for the `postgres` user (skip the password step on Windows, where the
installer already asked you for one):

```bash
psql -U postgres -c "ALTER USER postgres PASSWORD 'postgres';"
psql -U postgres -c "CREATE DATABASE zuri_express;"
```

(If `psql -U postgres` prompts for a password you don't know yet, on
macOS/Linux try running those two commands as the `postgres` system user
instead: `sudo -u postgres psql -c "..."`.) Then use the local connection
string shown (commented out) in `.env.example`.

</details>

## 2. Set up Google Sign-In

Email/password still works on its own — this step is only needed if you
want the "Sign in with Google" button on the frontend to work. It's free
and doesn't require a registered company (unlike the payment gateways).

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create a new project (top-left project dropdown → **New Project**). Name
   it e.g. `zuri-express`.
2. In the left sidebar, go to **APIs & Services → OAuth consent screen**.
   Choose **External** user type, fill in the required fields (app name
   "Zuri Express", your email for support/developer contact) and save —
   you can leave it in "Testing" mode for now, which is fine for
   development.
3. Go to **APIs & Services → Credentials**, click **+ Create Credentials →
   OAuth client ID**.
4. Application type: **Web application**. Name it anything.
5. Under **Authorized JavaScript origins**, add both:
   - `http://localhost:5173` (your future React dev server)
   - `http://localhost:4000` (this API, only needed if you ever call Google
     directly from a backend test page — safe to add either way)
6. Leave **Authorized redirect URIs** empty — this flow doesn't use
   redirects, the frontend gets a token directly via Google's script.
7. Click **Create**. Copy the **Client ID** shown (looks like
   `123456789-abc...apps.googleusercontent.com`). You do **not** need the
   client secret for this flow.
8. Paste it into `.env` as `GOOGLE_CLIENT_ID`.

When you build the React app, it'll use [Google Identity
Services](https://developers.google.com/identity/gsi/web/guides/overview)
(a small script tag, no extra backend work) to render the button and get a
token, then send that token to `POST /api/auth/google` below.

## 3. Set up email verification

A verified email is now **required** to use the cart or check out (see
"Email verification" below) — but setting up real email delivery itself is
still optional to start. Without `RESEND_API_KEY` set, signup still works
and both the verification code and link just print to your server console
instead of being emailed, which is fine for local development — you can
copy the code/link from the terminal and use it exactly as a real user
would. Set up Resend for real deployments so people actually receive the
email.

We use [Resend](https://resend.com) — free for this volume (100
emails/day), and unlike the payment gateways, it doesn't need a registered
company, just a domain you control.

1. Sign up at [resend.com](https://resend.com) and go to **API Keys** in
   the dashboard. Create a key and copy it.
2. Paste it into `.env` as `RESEND_API_KEY`.
3. For `EMAIL_FROM`, you need a sending address on a domain you've verified
   with Resend (**Domains** in their dashboard → add your domain → add the
   DNS records they show you at your domain registrar). If you don't have
   a domain yet, you have two options for now:
   - Buy a cheap domain (e.g. from Namecheap/Cloudflare, often
     $10-15/year) just for sending — you don't need a website on it, only
     the DNS records Resend asks for.
   - Skip this step entirely and leave `RESEND_API_KEY` unset until you do
     have a domain — verification links will keep working via the console
     fallback in the meantime, nothing else depends on this.
4. Once your domain is verified, set `EMAIL_FROM` to an address on it, e.g.
   `Zuri Express <noreply@zuriexpress.com>`.

## 4. Run the API

```bash
npm install
cp .env.example .env
# Edit .env: set SESSION_SECRET (openssl rand -base64 32), GOOGLE_CLIENT_ID
# (from step 2, optional for now — email/password still works without it),
# RESEND_API_KEY + EMAIL_FROM (from step 3, also optional — signup works
# without them, links just print to the console instead), and confirm
# DATABASE_URL matches the password you set above.

npx prisma migrate dev    # creates all tables from prisma/schema.prisma
npx prisma db seed        # sample Kenyan product catalog + admin user

npm run dev                # starts the API on http://localhost:4000
```

Check it's alive: `curl http://localhost:4000/health` → `{"ok":true}`.

**Admin login** (from the seed script): `admin@zuriexpress.com` /
`ChangeMe123!` — change this before any real deployment. There's no
"forgot password" flow yet; update it directly via
`npx prisma studio` (a GUI for the database) or a short script.

## 5. Try it out

There's no UI yet, so use `curl`, [Postman](https://www.postman.com/), or
similar. A couple of examples (note `-c`/`-b cookies.txt` to keep the
session cookie between requests, the way a browser would):

```bash
# Browse products
curl http://localhost:4000/api/products

# Sign up (saves the session cookie to cookies.txt)
curl -c cookies.txt -X POST http://localhost:4000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","password":"TestPass123!"}'

# Cart and checkout require a verified email (see "Email verification"
# below) — check the server console for the code/link this signup printed,
# then confirm it before the cart calls below will work:
curl -b cookies.txt -X POST http://localhost:4000/api/auth/verify-email-code \
  -H "Content-Type: application/json" \
  -d '{"code": "<the 6-digit code from the console>"}'

# Add something to the cart, then place an order from it using that session
curl -b cookies.txt -X POST http://localhost:4000/api/cart/items \
  -H "Content-Type: application/json" \
  -d '{"productId": "<a product id from /api/products>", "quantity": 1}'

curl -b cookies.txt -X POST http://localhost:4000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "address": {"fullName":"Test User","phone":"+905551112233","city":"Istanbul","addressLine":"Test Street 1","postalCode":"34000"},
    "paymentMethod": "BANK_TRANSFER"
  }'
```

Or run the automated check that exercises the whole API (signup, browse,
checkout, admin login, status update, product create/hide) in one go:

```bash
npm run smoke-test   # requires the dev server to already be running
```

## API reference

All routes are prefixed `/api`. Routes marked **auth** require a logged-in
user (any role); **verified** additionally requires `emailVerified: true`
(see "Email verification" below — signup itself doesn't require it, only
using the cart or checking out does); **admin** requires `role: ADMIN`.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/signup` | — | Create a customer account, starts a session |
| POST | `/auth/login` | — | Log in, starts a session |
| POST | `/auth/google` | — | Sign in with a Google ID token (`{ credential }`), starts a session — creates the account on first use, or links Google onto a matching existing email |
| GET | `/auth/verify-email?token=...` | — | Confirms the email address, via the link |
| POST | `/auth/verify-email-code` | auth | Confirms the email address, via the 6-digit code (`{code}`) — checked only against the caller's own account |
| POST | `/auth/resend-verification` | auth | Sends a fresh code + link |
| POST | `/auth/logout` | — | Clears the session |
| GET | `/auth/me` | auth | Current user |
| GET | `/categories` | — | List categories |
| GET | `/products?category=<slug>` | — | List active products, optionally filtered |
| GET | `/products/:slug` | — | One product |
| GET | `/cart` | verified | Your cart, items joined with live product data |
| POST | `/cart/items` | verified | Add a product (`{productId, quantity}`) — increments if already in the cart |
| PUT | `/cart/items/:productId` | verified | Set an absolute quantity (`{quantity}`) — `<= 0` removes it |
| DELETE | `/cart/items/:productId` | verified | Remove one product from the cart |
| DELETE | `/cart` | verified | Empty the whole cart |
| POST | `/orders` | verified | Place an order from your cart (see body shape above) — the cart is cleared once the order is created |
| GET | `/orders` | auth | Your own order history |
| GET | `/orders/:orderNumber` | auth | One of your own orders |
| GET | `/admin/dashboard` | admin | Order/stock summary stats |
| GET | `/admin/products` | admin | All products, including hidden |
| POST | `/admin/products` | admin | Create a product |
| PUT | `/admin/products/:id` | admin | Update a product |
| DELETE | `/admin/products/:id` | admin | Hide a product (soft delete — see note below) |
| GET | `/admin/orders` | admin | All orders |
| GET | `/admin/orders/:id` | admin | One order |
| PATCH | `/admin/orders/:id` | admin | Update status / payment note |

## Project structure

```
prisma/schema.prisma    Database schema — see comments for the
                         hybrid-fulfillment and manual-payment design
prisma/seed.ts           Sample catalog + admin user
src/
  app.ts                  Express app: middleware + route mounting
  server.ts                Entry point — starts the HTTP server
  lib/
    session.ts              Sign/verify the JWT session cookie
    cart.ts                  Server-side cart: get/add/set-quantity/
                             remove/clear, always returns items joined
                             with live product data
    orders.ts                createOrder() — takes a resolved item list
                             (routes/orders.ts resolves it from the cart),
                             never trusts client-sent prices, snapshots
                             prices, decrements stock in a transaction
    payments.ts               Payment provider abstraction (see above)
    verification.ts            Shared code/token generation + hashing for
                               email verification (used by routes/auth.ts
                               and smoke-test.ts)
    errors.ts                  Typed HTTP errors thrown from routes
  middleware/
    auth.ts                    attachUser / requireAuth / requireAdmin /
                               requireVerifiedEmail
    errorHandler.ts             Turns thrown errors into JSON responses
  routes/                       One file per resource
  smoke-test.ts                 End-to-end API check (see above)
```

## Data model notes

- **Fulfillment is hybrid per product** (`fulfillmentType`): `STOCKED`
  products carry a real `stock` count held locally in Türkiye; `ON_REQUEST`
  products carry a `leadTimeDays` estimate instead, for goods imported from
  Kenya per order.
- **Prices are stored as integer kuruş** (`priceKurus`, 1 TRY = 100 kuruş)
  to avoid floating-point rounding bugs. `src/lib/money.ts` converts at the
  edges; the admin product API accepts a plain `priceTRY` number and
  converts it for you.
- **Carts are stored server-side, per user** (`Cart`/`CartItem` — one cart
  per user, created lazily on first add-to-cart). This replaced an earlier
  localStorage-only design once it became clear a browser-local cart doesn't
  survive switching devices, and can even leak between users sharing one
  browser. `POST /api/orders` no longer accepts an item list from the
  client at all — it reads the caller's cart directly and clears it once
  the order is created. The server always re-fetches real prices and stock
  from the database regardless — it never trusts prices the client sends.
- **Order items snapshot** product name/price/fulfillment type at purchase
  time, so editing or hiding a product later never changes past order
  history.
- Deleting a product from the admin API actually sets `active: false`
  (soft delete) — hard-deleting would break the foreign key from any past
  order that references it.
- `User.passwordHash` is nullable — an account created purely via Google
  Sign-In has no password. `User.googleId` links an account to a Google
  account once they've signed in with it at least once (either a brand new
  account, or an existing email/password one that happened to share the
  same email).
- **Email verification is enforced on the cart and checkout** — a signed-up
  user can browse and log in right away, but `requireVerifiedEmail` (in
  `src/middleware/auth.ts`) blocks `/api/cart/*` and `POST /api/orders`
  with a 403 until `User.emailVerified` is true. Deliberately **not**
  applied to admin routes — those are already gated by role, and the
  seeded admin account's email is a placeholder that can't receive real
  mail. Every verification email carries both a link (`?token=...`,
  looked up globally — the token is long and unguessable) and a 6-digit
  code (checked only against the caller's own account via
  `POST /auth/verify-email-code`, so it can't be brute-forced the way a
  global lookup would allow); either one verifies the account, and both
  share one 24-hour expiry (see `src/lib/verification.ts`).

## Deploying (when you're ready)

**Recommended: [Railway](https://railway.com)** for hosting the Node app
itself — bills by actual usage (a low-traffic store runs close to the
$5/month Hobby plan minimum), and needs no Docker/config knowledge to get
started: connect this GitHub repo, set the same environment variables as
your `.env`, and it builds and runs `npm run build && npm start`
automatically.

Since the database is already on Supabase, you don't need Railway's own
Postgres too — just point Railway's `DATABASE_URL` at the same (or a
separate production) Supabase project. Two reasonable options: reuse your
dev Supabase project for a first soft-launch, or create a second Supabase
project for production so test orders never mix with real ones — create it
the same way as in step 1 above and use its connection string instead.

Before deploying for real:
1. Change the seeded admin password.
2. Generate a fresh `SESSION_SECRET` for production (don't reuse your local one).
3. Set `CLIENT_ORIGIN` to your deployed frontend's real URL once it exists.
4. Register the Turkish company and wire up iyzico/PayTR in `src/lib/payments.ts`.

## What's next

1. Build the React frontend against this API (separate project) — including
   the Google Sign-In button (Google Identity Services) and email/password
   forms calling the routes above
2. Real product photos (replace the `picsum.photos` placeholders in
   `prisma/seed.ts`)
3. A "forgot password" flow and a safer way to promote a user to admin
4. WhatsApp/email order-status notifications
5. Deploy to Railway once ready for the app to be reachable outside your
   own machine — remember to set `GOOGLE_CLIENT_ID` and add the deployed
   frontend's real URL to the Google Cloud OAuth client's Authorized
   JavaScript origins
