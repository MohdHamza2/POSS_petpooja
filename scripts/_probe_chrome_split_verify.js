require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4001";
const EMAIL = "admin@restaurant.com";
const PASS = "admin123";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const ORDER = "f84dbdf1-a689-4973-ab5c-b1982aa0d5f3";
const RICE = "434437c3-8c5b-4e0d-9f1a-2b3c4d5e6f70";

(async () => {
  const lr = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASS, outletId: OUTLET }),
  });
  const lj = await lr.json();
  const tok = lj.accessToken;
  const H = { Authorization: `Bearer ${tok}`, "X-Outlet-Id": OUTLET };
  const occ = await (await fetch(`${BASE}/tables/occupancy`, { headers: H })).json();
  const inv = await (await fetch(`${BASE}/reporting/invoices?limit=25`, { headers: H })).json();
  const zRes = await fetch(`${BASE}/finance/z-report`, { headers: H });
  const z = await zRes.json().catch(() => null);
  const settleAgain = await fetch(`${BASE}/orders/${ORDER}/settle`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ payments: [{ method: "CASH", amount: 16000 }] }),
  });
  const settleTxt = await settleAgain.text();
  const consumption = await prisma.inventoryConsumptionLog.findMany({
    where: { orderId: ORDER },
  });
  const riceCandidates = await prisma.ingredients.findMany({
    where: { name: { contains: "Basmati", mode: "insensitive" } },
    select: { id: true, name: true, current_stock_qty: true },
    take: 12,
  });
  const invRows = Array.isArray(inv) ? inv : inv.invoices || inv.data || [];
  const ours = (invRows || []).filter(
    (r) =>
      r.invoiceNumber === "INV-2026-00034" ||
      r.invoiceNumber === "INV-2026-00035" ||
      r.orderNumber === "20260831-0023"
  );
  console.log(
    JSON.stringify(
      {
        occupancy: occ,
        settleAgain: { status: settleAgain.status, body: settleTxt.slice(0, 400) },
        consumption,
        riceCandidates,
        invoiceListSample: ours.length
          ? ours
          : (invRows || []).slice(0, 4).map((r) => ({
              keys: Object.keys(r),
              n: r.invoiceNumber || r.number,
              amt: r.amountMinor || r.amount || r.grandTotal,
              order: r.orderNumber,
            })),
        invoiceCount: Array.isArray(invRows) ? invRows.length : null,
        zInvoiceCount: z && (z.invoiceCount || z.data && z.data.invoiceCount),
        zCash: z && (z.expectedCashMinor || z.cashExpected || z.data),
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
