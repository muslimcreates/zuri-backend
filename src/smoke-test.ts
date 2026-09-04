// A small end-to-end check that exercises the whole API against a running
// server: signup, browse, checkout, and the admin flows. Run with the dev
// server already up: `npm run dev` in one terminal, `npm run smoke-test` in
// another. Not a substitute for real tests (no test framework is wired up
// yet), but enough to catch a broken route before you go looking by hand.

import { prisma } from "./lib/prisma";
import { generateVerificationCode, generateVerificationToken, hashVerificationSecret } from "./lib/verification";

const BASE = process.env.API_BASE ?? "http://localhost:4000";

let failures = 0;

function ok(label: string, condition: boolean) {
  if (condition) {
    console.log(`OK   ${label}`);
  } else {
    console.error(`FAIL ${label}`);
    failures++;
  }
}

// Minimal cookie jar so we can simulate a browser session per "user".
function makeClient() {
  let cookie = "";
  return async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(init.headers ?? {}),
      },
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return res;
  };
}

async function main() {
  const health = await fetch(`${BASE}/health`);
  ok("GET /health", health.status === 200);

  const customer = makeClient();
  const email = `smoke${Date.now()}@example.com`;

  const signup = await customer("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ name: "Smoke Test", email, password: "TestPass123!" }),
  });
  ok("POST /api/auth/signup -> 201", signup.status === 201);

  const me = await customer("/api/auth/me");
  const meBody = (await me.json()) as any;
  ok("GET /api/auth/me returns the signed-up user", meBody.email === email);
  ok("New signup starts emailVerified: false", meBody.emailVerified === false);

  const resendVerification = await customer("/api/auth/resend-verification", { method: "POST" });
  const resendBody = (await resendVerification.json()) as any;
  ok("POST /api/auth/resend-verification -> 200", resendVerification.status === 200);
  ok("Resend response reports sent: true for an unverified account", resendBody.sent === true);

  const badVerify = await customer("/api/auth/verify-email?token=not-a-real-token");
  ok("GET /api/auth/verify-email with a bad token -> 400", badVerify.status === 400);

  const categories = await customer("/api/categories");
  const categoriesBody = (await categories.json()) as any;
  ok("GET /api/categories returns seeded categories", categoriesBody.length > 0);

  const products = await customer("/api/products");
  const productsBody = (await products.json()) as any;
  ok("GET /api/products returns seeded products", productsBody.length > 0);

  // Pick well-stocked STOCKED products rather than blindly using
  // productsBody[0] — the seeded catalog can end up with leftover
  // low/no-stock products from earlier manual testing, and this suite
  // itself decrements stock by 2 each run, so picking anything with too
  // little headroom makes the suite flaky on repeat runs.
  const wellStocked = productsBody.filter(
    (p: any) => p.fulfillmentType === "STOCKED" && (p.stock ?? 0) >= 10
  );
  ok("Seeded catalog has at least two well-stocked products to test against", wellStocked.length >= 2);
  const firstProduct = wellStocked[0] ?? productsBody[0];
  const secondProduct = wellStocked[1] ?? productsBody[1] ?? firstProduct;
  const productDetail = await customer(`/api/products/${firstProduct.slug}`);
  ok("GET /api/products/:slug -> 200", productDetail.status === 200);

  // --- Email verification enforcement (cart + checkout require it) ---
  // We can't read the real inbox from here, so — same trick a real attacker
  // couldn't pull off without DB access — seed a known code/token hash
  // directly via Prisma, using the exact same helpers routes/auth.ts uses,
  // then drive the HTTP endpoints exactly like a signed-in user would.
  const unverifiedCartAttempt = await customer("/api/cart/items", {
    method: "POST",
    body: JSON.stringify({ productId: firstProduct.id, quantity: 1 }),
  });
  ok("Cart is blocked (403) for an unverified account", unverifiedCartAttempt.status === 403);

  const unverifiedCheckoutAttempt = await customer("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      address: {
        fullName: "Smoke Test",
        phone: "+905551112233",
        city: "Istanbul",
        addressLine: "Test Street 1",
        postalCode: "34000",
      },
      paymentMethod: "BANK_TRANSFER",
    }),
  });
  ok("Checkout is blocked (403) for an unverified account", unverifiedCheckoutAttempt.status === 403);

  const wrongCode = await customer("/api/auth/verify-email-code", {
    method: "POST",
    body: JSON.stringify({ code: "000000" }),
  });
  ok("POST /api/auth/verify-email-code with a wrong code -> 400", wrongCode.status === 400);

  const rawCode = generateVerificationCode();
  await prisma.user.update({
    where: { email },
    data: {
      emailVerificationCodeHash: hashVerificationSecret(rawCode),
      emailVerificationExpires: new Date(Date.now() + 60_000),
    },
  });
  const verifyCode = await customer("/api/auth/verify-email-code", {
    method: "POST",
    body: JSON.stringify({ code: rawCode }),
  });
  const verifyCodeBody = (await verifyCode.json()) as any;
  ok(
    "POST /api/auth/verify-email-code with the right code -> 200",
    verifyCode.status === 200 && verifyCodeBody.verified === true
  );

  const meAfterVerify = await customer("/api/auth/me");
  const meAfterVerifyBody = (await meAfterVerify.json()) as any;
  ok("Account is emailVerified: true after verifying by code", meAfterVerifyBody.emailVerified === true);

  // Also cover the link/token path end to end, on a separate user so it
  // doesn't interfere with the code path just exercised above.
  const linkUser = makeClient();
  const linkEmail = `smoke-link${Date.now()}@example.com`;
  await linkUser("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ name: "Smoke Link", email: linkEmail, password: "TestPass123!" }),
  });
  const rawToken = generateVerificationToken();
  await prisma.user.update({
    where: { email: linkEmail },
    data: {
      emailVerificationTokenHash: hashVerificationSecret(rawToken),
      emailVerificationExpires: new Date(Date.now() + 60_000),
    },
  });
  const verifyLink = await linkUser(`/api/auth/verify-email?token=${rawToken}`);
  const verifyLinkBody = (await verifyLink.json()) as any;
  ok(
    "GET /api/auth/verify-email with the right token -> 200",
    verifyLink.status === 200 && verifyLinkBody.verified === true
  );

  // --- Cart (server-side, per user — see src/lib/cart.ts) ---
  const emptyCart = await customer("/api/cart");
  const emptyCartBody = (await emptyCart.json()) as any;
  ok("GET /api/cart starts empty for a new user", emptyCart.status === 200 && emptyCartBody.length === 0);

  const addItem = await customer("/api/cart/items", {
    method: "POST",
    body: JSON.stringify({ productId: firstProduct.id, quantity: 2 }),
  });
  const addItemBody = (await addItem.json()) as any;
  ok("POST /api/cart/items -> 201", addItem.status === 201);
  ok(
    "Cart now has the added product with the right quantity and joined product data",
    addItemBody.length === 1 && addItemBody[0].quantity === 2 && addItemBody[0].product?.id === firstProduct.id
  );

  const addSecondItem = await customer("/api/cart/items", {
    method: "POST",
    body: JSON.stringify({ productId: secondProduct.id, quantity: 1 }),
  });
  const addSecondItemBody = (await addSecondItem.json()) as any;
  ok("Adding a second product brings the cart to 2 lines", addSecondItemBody.length === 2);

  const addAgain = await customer("/api/cart/items", {
    method: "POST",
    body: JSON.stringify({ productId: firstProduct.id, quantity: 3 }),
  });
  const addAgainBody = (await addAgain.json()) as any;
  ok(
    "Adding an already-in-cart product increments its quantity (2 + 3 = 5), doesn't duplicate the line",
    addAgainBody.length === 2 && addAgainBody.find((i: any) => i.productId === firstProduct.id)?.quantity === 5
  );

  const setQty = await customer(`/api/cart/items/${firstProduct.id}`, {
    method: "PUT",
    body: JSON.stringify({ quantity: 2 }),
  });
  const setQtyBody = (await setQty.json()) as any;
  ok(
    "PUT /api/cart/items/:productId sets an absolute quantity",
    setQty.status === 200 && setQtyBody.find((i: any) => i.productId === firstProduct.id)?.quantity === 2
  );

  const removeItem = await customer(`/api/cart/items/${secondProduct.id}`, { method: "DELETE" });
  const removeItemBody = (await removeItem.json()) as any;
  ok(
    "DELETE /api/cart/items/:productId removes just that product",
    removeItem.status === 200 && removeItemBody.length === 1
  );

  // A second "session" (fresh cookie jar) for the same server, simulating a
  // different browser: should never see this cart. Verify this account too
  // (same seed-a-known-code trick as above) so the isolation check below is
  // actually exercising GET /api/cart rather than just re-confirming that
  // an unverified account is blocked.
  const otherBrowser = makeClient();
  const otherEmail = `smoke-other${Date.now()}@example.com`;
  await otherBrowser("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ name: "Smoke Test Other", email: otherEmail, password: "TestPass123!" }),
  });
  const otherRawCode = generateVerificationCode();
  await prisma.user.update({
    where: { email: otherEmail },
    data: {
      emailVerificationCodeHash: hashVerificationSecret(otherRawCode),
      emailVerificationExpires: new Date(Date.now() + 60_000),
    },
  });
  await otherBrowser("/api/auth/verify-email-code", {
    method: "POST",
    body: JSON.stringify({ code: otherRawCode }),
  });
  const otherCart = await otherBrowser("/api/cart");
  const otherCartBody = (await otherCart.json()) as any;
  ok(
    "A different signed-up user's cart is empty, not the first customer's items (no cross-user leak)",
    otherCart.status === 200 && otherCartBody.length === 0
  );

  const checkout = await customer("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      address: {
        fullName: "Smoke Test",
        phone: "+905551112233",
        city: "Istanbul",
        addressLine: "Test Street 1",
        postalCode: "34000",
      },
      paymentMethod: "BANK_TRANSFER",
    }),
  });
  const order = (await checkout.json()) as any;
  ok("POST /api/orders -> 201, sourced from the server-side cart (no items in the request body)", checkout.status === 201);
  ok("Order has an orderNumber", typeof order.orderNumber === "string");
  ok("Order picked up the item still in the cart (quantity 2)", order.items?.[0]?.quantity === 2);

  const cartAfterCheckout = await customer("/api/cart");
  const cartAfterCheckoutBody = (await cartAfterCheckout.json()) as any;
  ok("Cart is emptied once the order is placed", cartAfterCheckoutBody.length === 0);

  const emptyCheckout = await customer("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      address: {
        fullName: "Smoke Test",
        phone: "+905551112233",
        city: "Istanbul",
        addressLine: "Test Street 1",
        postalCode: "34000",
      },
      paymentMethod: "BANK_TRANSFER",
    }),
  });
  ok("Checking out again with an empty cart -> 400 (not a 201 with no items)", emptyCheckout.status === 400);

  const myOrders = await customer("/api/orders");
  const myOrdersBody = (await myOrders.json()) as any;
  ok("GET /api/orders includes the new order", myOrdersBody.some((o: any) => o.id === order.id));

  const otherOrder = await customer(`/api/orders/${order.orderNumber}`);
  ok("GET /api/orders/:orderNumber -> 200 for own order", otherOrder.status === 200);

  const unauthAdmin = await customer("/api/admin/products");
  ok("Non-admin blocked from /api/admin/products (403)", unauthAdmin.status === 403);

  // --- Admin flow, separate client/session ---
  const admin = makeClient();
  const adminLogin = await admin("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@zuriexpress.com", password: "ChangeMe123!" }),
  });
  ok("POST /api/auth/login (admin) -> 200", adminLogin.status === 200);

  const dashboard = await admin("/api/admin/dashboard");
  const dashboardBody = (await dashboard.json()) as any;
  ok("GET /api/admin/dashboard -> 200", dashboard.status === 200);
  ok("Dashboard totalOrders > 0", dashboardBody.totalOrders > 0);

  const adminOrders = await admin("/api/admin/orders");
  const adminOrdersBody = (await adminOrders.json()) as any;
  ok(
    "GET /api/admin/orders includes the smoke-test order",
    adminOrdersBody.some((o: any) => o.id === order.id)
  );

  const statusUpdate = await admin(`/api/admin/orders/${order.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "PAYMENT_RECEIVED", paymentNote: "havale ref 12345" }),
  });
  const statusUpdateBody = (await statusUpdate.json()) as any;
  ok("PATCH order status -> 200", statusUpdate.status === 200);
  ok("Order status updated", statusUpdateBody.status === "PAYMENT_RECEIVED");

  const newProduct = await admin("/api/admin/products", {
    method: "POST",
    body: JSON.stringify({
      name: "Smoke Test Product",
      description: "Created by the automated smoke test.",
      imageUrl: "https://picsum.photos/seed/smoke/600/600",
      priceTRY: 99.9,
      categoryId: firstProduct.categoryId,
      fulfillmentType: "STOCKED",
      stock: 5,
      active: true,
    }),
  });
  const newProductBody = (await newProduct.json()) as any;
  ok("POST /api/admin/products -> 201", newProduct.status === 201);

  const shopAfterCreate = await customer("/api/products");
  const shopAfterCreateBody = (await shopAfterCreate.json()) as any;
  ok(
    "New product visible on public product list",
    shopAfterCreateBody.some((p: any) => p.id === newProductBody.id)
  );

  const hideProduct = await admin(`/api/admin/products/${newProductBody.id}`, {
    method: "DELETE",
  });
  ok("DELETE /api/admin/products/:id -> 204", hideProduct.status === 204);

  const shopAfterHide = await customer("/api/products");
  const shopAfterHideBody = (await shopAfterHide.json()) as any;
  ok(
    "Hidden product no longer visible on public product list",
    !shopAfterHideBody.some((p: any) => p.id === newProductBody.id)
  );

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SMOKE TEST CRASHED:", e);
  process.exit(1);
});
