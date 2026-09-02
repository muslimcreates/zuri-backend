// A small end-to-end check that exercises the whole API against a running
// server: signup, browse, checkout, and the admin flows. Run with the dev
// server already up: `npm run dev` in one terminal, `npm run smoke-test` in
// another. Not a substitute for real tests (no test framework is wired up
// yet), but enough to catch a broken route before you go looking by hand.

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

  const firstProduct = productsBody[0];
  const productDetail = await customer(`/api/products/${firstProduct.slug}`);
  ok("GET /api/products/:slug -> 200", productDetail.status === 200);

  const checkout = await customer("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      items: [{ productId: firstProduct.id, quantity: 2 }],
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
  ok("POST /api/orders -> 201", checkout.status === 201);
  ok("Order has an orderNumber", typeof order.orderNumber === "string");

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
