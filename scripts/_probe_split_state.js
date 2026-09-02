require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const BIRYANI = "923df5bf-7d93-4061-926e-8a5c2c41d7d0";

(async () => {
  const latest = await prisma.order.findFirst({
    where: { outletId: OUTLET },
    orderBy: { createdAt: "desc" },
    include: { kotTickets: true, invoices: true, diningTable: true },
  });
  const payments = latest
    ? await prisma.payment.findMany({ where: { orderId: latest.id } })
    : [];
  const consumption = latest
    ? await prisma.inventoryConsumptionLog.findMany({ where: { orderId: latest.id } })
    : [];
  const leftover = await prisma.order.findFirst({
    where: { orderNumber: "20260831-0008" },
    include: { diningTable: true, kotTickets: true, invoices: true },
  });
  const occupied = await prisma.diningTable.findMany({
    where: { outletId: OUTLET, status: { not: "VACANT" } },
    select: { tableNumber: true, status: true, mergeGroupId: true, id: true },
  });
  const avail = await prisma.item_availability.findMany({
    where: { item_id: BIRYANI },
  });
  const store = await prisma.outlet_status.findUnique({ where: { outlet_id: OUTLET } });
  console.log(
    JSON.stringify(
      {
        latest: latest && {
          id: latest.id,
          orderNumber: latest.orderNumber,
          status: latest.status,
          settledAt: latest.settledAt,
          grand: String(latest.grandTotal),
          table: latest.diningTable && latest.diningTable.tableNumber,
          tableStatus: latest.diningTable && latest.diningTable.status,
          kots: latest.kotTickets.map((k) => k.status),
          invoiceCount: latest.invoices.length,
          invoices: latest.invoices.map((i) => ({
            n: i.invoiceNumber,
            amount: String(i.amountMinor),
          })),
          paymentCount: payments.length,
          payments: payments.map((p) => ({ method: p.method, amount: String(p.amount) })),
          bomRows: consumption.length,
        },
        leftover: leftover && {
          id: leftover.id,
          status: leftover.status,
          settledAt: leftover.settledAt,
          table: leftover.diningTable && leftover.diningTable.tableNumber,
          tableStatus: leftover.diningTable && leftover.diningTable.status,
          invoices: leftover.invoices.length,
          kots: leftover.kotTickets.map((k) => k.status),
        },
        occupied,
        store,
        biryaniAvail: avail.map((a) => ({
          id: a.id,
          state: a.state,
          channel: a.channel_id,
          version: a.version,
        })),
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
