require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const pickup = await prisma.order.findFirst({
    where: { orderNumber: "20260831-0025" },
    include: { kotTickets: true, invoices: true, diningTable: true },
  });
  const hotel = await prisma.order.findFirst({
    where: { orderNumber: "20260831-0027" },
    include: { kotTickets: true, diningTable: true },
  });
  const json = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);
  console.log(
    json({
      pickup: pickup && {
        id: pickup.id,
        type: pickup.orderType,
        status: pickup.status,
        settledAt: pickup.settledAt,
        invoices: pickup.invoices.length,
        table: pickup.diningTable && pickup.diningTable.tableNumber,
        kots: pickup.kotTickets.map((k) => ({ id: k.id, num: k.ticketNumber, status: k.status })),
      },
      hotel: hotel && {
        id: hotel.id,
        type: hotel.orderType,
        status: hotel.status,
        table: hotel.diningTable && { n: hotel.diningTable.tableNumber, s: hotel.diningTable.status },
        kots: hotel.kotTickets.map((k) => ({ id: k.id, num: k.ticketNumber, status: k.status })),
      },
    })
  );
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
