require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const PO = "68ea41ad-fd1c-416e-a21b-2444247ba684";

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
    Authorization: `Bearer ${TOK}`,
    "X-Outlet-Id": OUTLET,
    "Content-Type": "application/json",
  };
  const month = await fetch(
    `${BASE}/reporting/table-turnaround?fromDate=2026-08-01T00:00:00.000Z&toDate=2026-08-31T23:59:59.999Z`,
    { headers: H }
  );
  const day = await fetch(
    `${BASE}/reporting/table-turnaround?fromDate=2026-08-31T00:00:00.000Z&toDate=2026-08-31T23:59:59.999Z`,
    { headers: H }
  );
  const riceBefore = await prisma.ingredients.findFirst({
    where: { name: "Premium Basmati Rice 1787910588805" },
  });
  const grn = await fetch(`${BASE}/inventory/purchase-orders/${PO}/receive`, {
    method: "POST",
    headers: H,
  });
  const grnBody = await grn.json().catch(() => ({}));
  const riceAfter = await prisma.ingredients.findFirst({
    where: { name: "Premium Basmati Rice 1787910588805" },
  });
  const poAfter = await prisma.purchase_orders.findUnique({
    where: { id: PO },
    include: { purchase_order_items: true },
  });
  console.log(
    JSON.stringify(
      {
        ttaMonth: { status: month.status, body: await month.json() },
        ttaDay: { status: day.status, body: await day.json() },
        grn: { status: grn.status, body: grnBody },
        rice: {
          before: riceBefore && String(riceBefore.current_stock_qty),
          after: riceAfter && String(riceAfter.current_stock_qty),
        },
        po: poAfter && {
          status: poAfter.status,
          received: poAfter.purchase_order_items.map((i) => String(i.received_qty)),
        },
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
