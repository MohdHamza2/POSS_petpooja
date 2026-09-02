require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);

(async () => {
  const lr = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@restaurant.com", password: "admin123", outletId: OUTLET }),
  });
  const { accessToken } = await lr.json();
  const H = { Authorization: `Bearer ${accessToken}`, "X-Outlet-Id": OUTLET, "Content-Type": "application/json" };

  const me = await (await fetch(`${BASE}/auth/me`, { headers: H })).json();
  const outletSettings = await (await fetch(`${BASE}/settings/outlet`, { headers: H })).json();
  const occ = await (await fetch(`${BASE}/tables/occupancy`, { headers: H })).json();
  const drawer = await (await fetch(`${BASE}/finance/cash-drawer`, { headers: H })).json();
  const pos = await (await fetch(`${BASE}/inventory/purchase-orders`, { headers: H })).json();
  const poList = Array.isArray(pos) ? pos : pos.purchaseOrders || pos.orders || [];
  const openPos = poList.map((p) => ({
    id: p.id,
    number: p.poNumber || p.po_number,
    status: p.status,
    vendor: p.vendorName || (p.vendors && p.vendors.name),
    items: (p.items || p.purchase_order_items || []).map((i) => ({
      ingredientId: i.ingredientId || i.ingredient_id,
      name: i.ingredientName || (i.ingredients && i.ingredients.name),
      qty: i.quantity,
      received: i.receivedQty || i.received_qty,
    })),
  }));
  const remaining = openPos.filter((p) =>
    (p.items || []).some((i) => Number(i.received || 0) < Number(i.qty || 0))
  );
  const org = await prisma.organization.findFirst({ select: { id: true, name: true, tax_id: true } });
  const kitchen = await (await fetch(`${BASE}/kitchen/tickets`, { headers: H })).json().catch(() => null);
  const kitchenAlt = kitchen && kitchen.error
    ? await (await fetch(`${BASE}/kitchen/stations`, { headers: H })).json().catch(() => null)
    : kitchen;

  console.log(
    json({
      meTax: me.outlet && me.outlet.taxNumber,
      settingsTax: outletSettings.taxNumber,
      orgTax: org && org.tax_id,
      occ,
      drawer: { expected: drawer.expectedCashMinor, cash: drawer.cashSalesMinor, session: drawer.sessionStatus },
      poCount: poList.length,
      remainingPoCount: remaining.length,
      remainingPos: remaining.slice(0, 5),
      kitchenKeys: kitchenAlt && typeof kitchenAlt === "object" ? Object.keys(kitchenAlt) : typeof kitchenAlt,
    })
  );
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
