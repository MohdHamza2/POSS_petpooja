require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const ID = "1048e577-d379-4abc-83a3-123eafc2f0d1";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
(async () => {
  const invoices = await prisma.invoice.findMany({ where: { orderId: ID }, orderBy: { splitIndex: "asc" } });
  const bom = await prisma.inventoryConsumptionLog.findMany({ where: { orderId: ID } });
  const rice = await prisma.ingredients.findFirst({ where: { id: "434437c3-4607-4b7b-9384-54f0ee1c1acd" } });
  const table = await prisma.diningTable.findFirst({ where: { outletId: OUTLET, tableNumber: "T-09" } });
  console.log(JSON.stringify({
    invoices: invoices.map((i) => ({ n: i.invoiceNumber, idx: i.splitIndex, amount: String(i.amountMinor), tax: String(i.taxAmountMinor) })),
    taxSum: invoices.reduce((s, i) => s + i.taxAmountMinor, 0n).toString(),
    bom: bom.map((b) => ({ qty: String(b.quantityDeducted), remaining: String(b.remainingStock), reason: b.reasonCode })),
    rice: rice && String(rice.current_stock_qty),
    t09: table && table.status,
  }, null, 2));
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
