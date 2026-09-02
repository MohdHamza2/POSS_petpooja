require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
let TOK = "";
function H() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOK}`,
    "X-Outlet-Id": OUTLET,
  };
}
async function j(m, p, b) {
  const r = await fetch(`${BASE}${p}`, {
    method: m,
    headers: H(),
    body: b ? JSON.stringify(b) : undefined,
  });
  const t = await r.text();
  let d;
  try {
    d = JSON.parse(t);
  } catch {
    d = t;
  }
  return { status: r.status, data: d };
}
function log(l, o) {
  console.log(`\n### ${l}`);
  console.log(typeof o === "string" ? o : JSON.stringify(o, null, 2));
}

(async () => {
  try {
    const lr = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@restaurant.com",
        password: "admin123",
        outletId: OUTLET,
      }),
    });
    TOK = (await lr.json()).accessToken;

    const patched = await j("PATCH", "/settings/outlet", {
      loyaltyPaisePerPoint: "10000",
      taxNumber: "27AABCT1234A1Z5",
    });
    log("PATCH outlet", { status: patched.status, data: patched.data });

    const me = await j("GET", "/auth/me");
    log("auth/me", {
      code: me.data && me.data.outlet && me.data.outlet.code,
      name: me.data && me.data.outlet && me.data.outlet.name,
      taxNumber: me.data && me.data.outlet && me.data.outlet.taxNumber,
      loyalty: me.data && me.data.outlet && me.data.outlet.loyaltyPaisePerPoint,
    });

    const avail = await j("GET", "/menu/availability");
    const availItems = Array.isArray(avail.data) ? avail.data : [];
    const biryani = availItems.find((i) => i.name && i.name.includes("Biryani"));
    log("availability biryani taxRate", {
      id: biryani && biryani.id,
      taxRate: biryani && biryani.taxRate,
      priceMinor: biryani && biryani.priceMinor,
    });

    const recipes = await j("GET", "/inventory/recipes");
    const recs = Array.isArray(recipes.data) ? recipes.data : [];
    const rec = recs.find((r) => r.menuItemId === (biryani && biryani.id)) || recs[0];
    const bomIng = rec && (rec.recipeIngredients || rec.ingredients || [])[0];
    log("latest listed recipe for deduct", {
      recipeId: rec && rec.id,
      name: rec && rec.name,
      version: rec && rec.version,
      ingredientId: bomIng && (bomIng.ingredientId || (bomIng.ingredient && bomIng.ingredient.id)),
      ingredientName: bomIng && (bomIng.ingredientName || (bomIng.ingredient && bomIng.ingredient.name)),
      stock: bomIng && bomIng.ingredient && bomIng.ingredient.currentStock,
    });

    const ingId = bomIng && (bomIng.ingredientId || (bomIng.ingredient && bomIng.ingredient.id));
    const invBefore = await j("GET", "/inventory/ingredients");
    const ingList = Array.isArray(invBefore.data) ? invBefore.data : [];
    const stockBefore = ingList.find((i) => i.id === ingId);
    log("target ingredient BEFORE", stockBefore);

    const tbls = await j("GET", "/tables");
    const tarr = Array.isArray(tbls.data) ? tbls.data : [];
    const vac = tarr.find(
      (t) =>
        (t.status === "VACANT" || t.status === "AVAILABLE") &&
        !t.currentOrder &&
        !t.mergeGroupId
    );
    const phone = `99${String(Date.now()).slice(-8)}`;
    const cust = await j("POST", "/crm/customers", {
      firstName: "PostFix",
      lastName: "Cover",
      phone,
    });
    log("customer", { status: cust.status, id: cust.data && cust.data.id, points: cust.data && cust.data.loyaltyPoints });

    const create = await j("POST", "/orders", {
      action: "KOT",
      diningTableId: vac.id,
      tableNumber: vac.tableNumber,
      orderType: "DINE_IN",
      customerId: cust.data.id,
      lines: [{ menuItemId: biryani.id, quantity: 1 }],
    });
    const oid = create.data && create.data.id;
    const bill = await j("GET", `/orders/${oid}/bill`);
    log("bill inclusive", {
      sub: bill.data && bill.data.subtotalMinor,
      tax: bill.data && bill.data.taxTotalMinor,
      grand: bill.data && bill.data.grandTotalMinor,
      posAdditiveWouldBe: Number(bill.data.subtotalMinor) + Math.round(Number(bill.data.subtotalMinor) * 0.05),
    });

    const settle = await j("POST", `/orders/${oid}/settle`, {
      paymentMethod: "CASH",
      amountPaidMinor: Number(bill.data.grandTotalMinor),
      customerId: cust.data.id,
    });
    log("SETTLE", { status: settle.status, invoice: settle.data && settle.data.invoiceNumber, error: settle.data && settle.data.error });

    const invAfter = await j("GET", "/inventory/ingredients");
    const ingListA = Array.isArray(invAfter.data) ? invAfter.data : [];
    const stockAfter = ingListA.find((i) => i.id === ingId);
    log("target ingredient AFTER", stockAfter);

    const prisma = new PrismaClient();
    const logs = await prisma.inventoryConsumptionLog.findMany({
      where: { orderId: oid },
    });
    log("consumption", logs.map((l) => ({
      recipeId: l.recipeId,
      ingredientId: l.ingredientId,
      qty: Number(l.quantityDeducted),
      remaining: Number(l.remainingStock),
      reason: l.reasonCode,
    })));
    const acct = await prisma.loyalty_accounts.findUnique({ where: { customer_id: cust.data.id } });
    await prisma.$disconnect();

    const custAfter = await j("GET", `/crm/customers/${cust.data.id}`);
    log("CRM vs account", {
      apiPoints: custAfter.data && custAfter.data.loyaltyPoints,
      acctBalance: acct && Number(acct.balance),
      match: acct && Number(acct.balance) === Number(custAfter.data && custAfter.data.loyaltyPoints),
    });

    const again = await j("POST", `/orders/${oid}/settle`, { paymentMethod: "CASH" });
    log("re-settle", { status: again.status, error: again.data && again.data.error });

    console.log("\n=== POST-FIX STOCK/GST/CRM PROBE DONE ===");
  } catch (e) {
    console.log("ERR", e && e.stack ? e.stack : String(e));
  }
})();
