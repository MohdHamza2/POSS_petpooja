require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const LIVE = ["DRAFT","PLACED","CONFIRMED","KOT_CREATED","IN_PREPARATION","READY","SERVED","HANDED_OVER","BILLING"];

(async () => {
  const occupied = await prisma.diningTable.findMany({
    where: { outletId: OUTLET, status: { not: "VACANT" } },
  });
  const ids = occupied.map((t) => t.id);
  const numbers = occupied.map((t) => t.tableNumber);
  const live = await prisma.order.findMany({
    where: {
      outletId: OUTLET,
      status: { in: LIVE },
      OR: [
        { diningTableId: { in: ids } },
        { table_number: { in: numbers } },
      ],
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      diningTableId: true,
      table_number: true,
      settledAt: true,
    },
  });
  console.log(JSON.stringify({ occupiedCount: occupied.length, occupied: occupied.map((t) => ({ n: t.tableNumber, status: t.status, merge: t.mergeGroupId })), live }, null, 2));
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
