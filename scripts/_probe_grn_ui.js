require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);

(async () => {
  const po = await prisma.purchase_orders.findUnique({
    where: { id: "c07636e3-3c2a-4d68-8e50-1f3d6990489e" },
    include: { purchase_order_items: true },
  });
  const riceGrn = await prisma.ingredients.findUnique({
    where: { id: "5a579291-b824-4761-b1f6-676c08726473" },
    select: { name: true, current_stock_qty: true },
  });
  const riceBom = await prisma.ingredients.findUnique({
    where: { id: "434437c3-4607-4b7b-9384-54f0ee1c1acd" },
    select: { name: true, current_stock_qty: true },
  });
  console.log(
    json({
      po: po && {
        n: po.po_number,
        s: po.status,
        recv: po.purchase_order_items.map((i) => ({ q: Number(i.quantity), r: Number(i.received_qty) })),
      },
      riceGrn,
      riceBom,
    })
  );
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
