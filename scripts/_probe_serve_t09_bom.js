require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";

(async () => {
  const lr = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@restaurant.com",
      password: "admin123",
      outletId: OUTLET,
    }),
  });
  const TOK = (await lr.json()).accessToken;
  const H = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOK}`,
    "X-Outlet-Id": OUTLET,
  };
  const tables = await (await fetch(`${BASE}/tables`, { headers: H })).json();
  const t = tables.find((x) => x.tableNumber === "T-09");
  const kots = (t && t.currentOrder && t.currentOrder.kots) || [];
  const results = [];
  for (const k of kots) {
    for (const toStatus of ["PREPARING", "READY", "SERVED"]) {
      const r = await fetch(`${BASE}/kitchen/kot/${k.id}/status`, {
        method: "PATCH",
        headers: H,
        body: JSON.stringify({ toStatus }),
      });
      results.push({ id: k.id, toStatus, status: r.status });
    }
  }
  const rice = await prisma.ingredients.findFirst({
    where: { name: { contains: "Basmati Rice" } },
  });
  console.log(
    JSON.stringify(
      {
        orderId: t && t.activeOrderId,
        orderNumber: t && t.currentOrder && t.currentOrder.orderNumber,
        kots: kots.map((k) => ({ id: k.id, status: k.status })),
        results,
        rice: rice && { id: rice.id, name: rice.name, stock: String(rice.current_stock_qty) },
      },
      null,
      2
    )
  );
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
