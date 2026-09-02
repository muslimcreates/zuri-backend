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

## 1. Install PostgreSQL locally

You need Postgres running on your own machine for local development
(separate from wherever it ends up hosted in production — see the
deployment section below).

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
instead: `sudo -u postgres psql -c "..."`.)

## 2. Run the API

```bash
npm install
cp .env.example .env
# Edit .env: set SESSION_SECRET (openssl rand -base64 32) and confirm
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

## 3. Try it out

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

# Place an order using that session
curl -b cookies.txt -X POST http://localhost:4000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "items": [{"productId": "<a product id from /api/products>", "quantity": 1}],
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
user (any role); **admin** requires `role: ADMIN`.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/signup` | — | Create a customer account, starts a session |
| POST | `/auth/login` | — | Log in, starts a session |
| POST | `/auth/logout` | — | Clears the session |
| GET | `/auth/me` | auth | Current user |
| GET | `/categories` | — | List categories |
| GET | `/products?category=<slug>` | — | List active products, optionally filtered |
| GET | `/products/:slug` | — | One product |
| POST | `/orders` | auth | Place an order (see body shape above) |
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
    orders.ts                createOrder() — validates cart server-side
                             (never trusts client-sent prices), snapshots
                             prices, decrements stock in a transaction
    payments.ts               Payment provider abstraction (see above)
    errors.ts                  Typed HTTP errors thrown from routes
  middleware/
    auth.ts                    attachUser / requireAuth / requireAdmin
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
- **This API doesn't store carts.** The frontend owns cart state (e.g. in
  localStorage) and only tells the backend about it at checkout time
  (`POST /api/orders` takes a list of `{productId, quantity}`). The server
  always re-fetches real prices and stock from the database — it never
  trusts prices the client sends.
- **Order items snapshot** product name/price/fulfillment type at purchase
  time, so editing or hiding a product later never changes past order
  history.
- Deleting a product from the admin API actually sets `active: false`
  (soft delete) — hard-deleting would break the foreign key from any past
  order that references it.

## Deploying (when you're ready)

**Recommended: [Railway](https://railway.com).** It hosts the Node app and
a Postgres database in one project, bills by actual usage (a low-traffic
store runs close to the $5/month Hobby plan minimum), and needs no
Docker/config knowledge to get started — connect this GitHub repo, add a
Postgres service from Railway's dashboard, set the same environment
variables as your `.env` (Railway generates `DATABASE_URL` for you when you
add its Postgres service), and it builds and runs `npm run build && npm
start` automatically.

Before deploying for real:
1. Change the seeded admin password.
2. Generate a fresh `SESSION_SECRET` for production (don't reuse your local one).
3. Set `CLIENT_ORIGIN` to your deployed frontend's real URL once it exists.
4. Register the Turkish company and wire up iyzico/PayTR in `src/lib/payments.ts`.

## What's next

1. Build the React frontend against this API (separate project)
2. Real product photos (replace the `picsum.photos` placeholders in
   `prisma/seed.ts`)
3. A "forgot password" flow and a safer way to promote a user to admin
4. WhatsApp/email order-status notifications
5. Deploy to Railway once ready for the app to be reachable outside your
   own machine
