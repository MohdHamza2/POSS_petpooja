import type { PrismaClient } from "@prisma/client";
import { transitionOrder, PrismaOrderRepository } from "@kapmeta/orders";
import type { OrderStatus } from "@kapmeta/shared-types/orders";
import { deductBomStockForOrder } from "./inventory-depletion";
import { dissolveMergeGroupForTable } from "./table-merge";

export interface SettleOrderInput {
  outletId: string;
  orderId: string;
  userId: string;
  paymentMethod?: string;
  amountPaidMinor?: bigint | string | number;
  payments?: { method: string; amountMinor: bigint | string | number }[];
}

export interface SettleOrderResult {
  ok: true;
  orderId: string;
  status: string;
  invoiceNumber: string;
  alreadySettled: boolean;
}

const DINE_CHAIN: OrderStatus[] = [
  "CONFIRMED",
  "KOT_CREATED",
  "IN_PREPARATION",
  "READY",
  "SERVED",
  "COMPLETED",
];

const TAKEAWAY_CHAIN: OrderStatus[] = [
  "CONFIRMED",
  "KOT_CREATED",
  "IN_PREPARATION",
  "READY",
  "HANDED_OVER",
  "COMPLETED",
];

async function enqueueOutbox(
  prisma: PrismaClient,
  outletId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.outboxEvent.create({
      data: { outletId, eventType, payload: payload as object },
    });
  } catch (err) {
    console.error("outbox enqueue failed", eventType, err);
  }
}

async function nextInvoiceNumber(prisma: PrismaClient, outletId: string): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.invoice.count({
    where: { outletId, invoiceNumber: { startsWith: `INV-${year}-` } },
  });
  return `INV-${year}-${String(count + 1).padStart(5, "0")}`;
}

export async function settleOrderCommand(
  prisma: PrismaClient,
  input: SettleOrderInput
): Promise<SettleOrderResult> {
  const { outletId, orderId, userId } = input;
  const orderRepo = new PrismaOrderRepository(prisma);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { orderItems: true },
  });
  if (!order || order.outletId !== outletId) {
    throw new Error("Order not found");
  }

  const existingInvoice = await prisma.invoice.findUnique({ where: { orderId } }).catch(() => null);
  if (order.status === "COMPLETED") {

    const existingPays = await prisma.payment.findMany({
      where: { orderId, outletId, status: "CAPTURED" },
    });
    const alreadyPaid = existingPays.reduce((sum, p) => sum + p.amount, 0n);
    let invoice = existingInvoice;
    if (!invoice) {
      const invoiceNumber = await nextInvoiceNumber(prisma, outletId);
      invoice = await prisma.invoice.create({
        data: {
          outletId,
          orderId,
          invoiceNumber,
          amountMinor: order.grandTotal,
          taxAmountMinor: order.taxTotal ?? 0n,
        },
      });
    }
    if (!order.settledAt) {
      await prisma.order.update({
        where: { id: orderId },
        data: { settledAt: new Date() },
      });
    }
    const dissolved = order.diningTableId
      ? await dissolveMergeGroupForTable(prisma, outletId, order.diningTableId)
      : { ids: [] as string[], numbers: [] as string[] };
    if (dissolved.ids.length === 0 && order.table_number) {
      await prisma.diningTable.updateMany({
        where: { outletId, tableNumber: order.table_number },
        data: { status: "VACANT", mergeGroupId: null, mergePrimaryTableId: null },
      });
    }
    const bom = await deductBomStockForOrder(orderId, outletId, prisma, userId, "ORDER_SETTLED");
    await enqueueOutbox(prisma, outletId, "order.settled", {
      orderId,
      invoiceNumber: invoice.invoiceNumber,
      paymentMethod: input.paymentMethod || null,
      amountMinor: alreadyPaid.toString(),
    });
    import("../websockets").then(({ broadcast }) => {
      broadcast("finance.order_settled", {
        orderId,
        outletId,
        paymentMethod: input.paymentMethod || null,
        amountMinor: alreadyPaid.toString(),
        invoiceNumber: invoice!.invoiceNumber,
      });
      broadcast("table.unmerged", { tableIds: dissolved.ids, orderId });
      const vacantIds = dissolved.ids.length > 0
        ? dissolved.ids
        : (order.diningTableId ? [order.diningTableId] : []);
      for (const id of vacantIds) {
        broadcast("table.status_updated", { tableId: id, orderId, status: "VACANT" });
      }
      if (bom.deductedCount > 0) {
        broadcast("inventory.stock_updated", { orderId, deductedCount: bom.deductedCount });
      }
    }).catch(() => undefined);
    return {
      ok: true,
      orderId,
      status: "COMPLETED",
      invoiceNumber: invoice.invoiceNumber,
      alreadySettled: true,
    };
  }
  if (order.status === "CANCELLED" || order.status === "FAILED") {
    throw new Error(`Cannot settle order in status ${order.status}`);
  }

  const isTakeaway = order.orderType === "PICKUP" || String(order.orderType) === "TAKEAWAY";
  const statusChain = isTakeaway ? TAKEAWAY_CHAIN : DINE_CHAIN;
  const terminal = new Set(["COMPLETED", "CANCELLED", "FAILED"]);

  for (const targetStatus of statusChain) {
    const fresh = await prisma.order.findUnique({ where: { id: orderId } });
    if (!fresh || terminal.has(fresh.status)) break;
    const currentIdx = statusChain.indexOf(fresh.status as OrderStatus);
    const targetIdx = statusChain.indexOf(targetStatus);
    if (currentIdx >= 0 && currentIdx >= targetIdx) continue;
    const result = await transitionOrder(orderId, targetStatus, orderRepo, userId);
    if (!result.ok) {
      console.error(`Settlement transition ${fresh.status} -> ${targetStatus} failed`, result);
    }
  }

  const splitPays = Array.isArray(input.payments) && input.payments.length > 0
    ? input.payments.map((p) => ({ method: p.method, amount: BigInt(p.amountMinor) }))
    : (input.paymentMethod
      ? [{ method: input.paymentMethod, amount: input.amountPaidMinor != null ? BigInt(input.amountPaidMinor) : order.grandTotal }]
      : []);
  const payAmount = splitPays.reduce((sum, p) => sum + p.amount, 0n);
  const payMethod = splitPays.length > 1 ? "SPLIT" : (splitPays[0]?.method || input.paymentMethod);

  const existingPays = await prisma.payment.findMany({
    where: { orderId, outletId, status: "CAPTURED" },
  });
  const alreadyPaid = existingPays.reduce((sum, p) => sum + p.amount, 0n);
  let remainingToRecord = alreadyPaid;
  for (const p of splitPays) {
    if (remainingToRecord >= order.grandTotal) break;
    const chunk = remainingToRecord + p.amount > order.grandTotal
      ? order.grandTotal - remainingToRecord
      : p.amount;
    if (chunk <= 0n) continue;
    await orderRepo.recordPayment(outletId, orderId, chunk, p.method, userId);
    remainingToRecord += chunk;
    if (String(p.method).toUpperCase() === "CASH") {
      const activeDrawer = await prisma.cash_drawer_sessions.findFirst({
        where: { outlet_id: outletId, status: "OPEN" },
        orderBy: { opened_at: "desc" },
      });
      if (activeDrawer) {
        await prisma.cash_drawer_sessions.update({
          where: { id: activeDrawer.id },
          data: {
            expected_close_balance_minor: { increment: chunk },
            updated_at: new Date(),
          },
        });
      }
    }
  }

  let invoice = await prisma.invoice.findUnique({ where: { orderId } });
  if (!invoice) {
    const invoiceNumber = await nextInvoiceNumber(prisma, outletId);
    invoice = await prisma.invoice.create({
      data: {
        outletId,
        orderId,
        invoiceNumber,
        amountMinor: order.grandTotal,
        taxAmountMinor: order.taxTotal ?? 0n,
      },
    });
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { settledAt: new Date() },
  });

  const dissolved = order.diningTableId
    ? await dissolveMergeGroupForTable(prisma, outletId, order.diningTableId)
    : { ids: [] as string[], numbers: [] as string[] };
  if (dissolved.ids.length === 0 && order.table_number) {
    await prisma.diningTable.updateMany({
      where: { outletId, tableNumber: order.table_number },
      data: { status: "VACANT", mergeGroupId: null, mergePrimaryTableId: null },
    });
  }

  const bom = await deductBomStockForOrder(orderId, outletId, prisma, userId, "ORDER_SETTLED");

  if (order.customerId) {
    const outlet = await prisma.outlet.findUnique({ where: { id: outletId } });
    const paisePerPoint = outlet?.loyaltyPaisePerPoint;
    if (paisePerPoint && paisePerPoint > 0n) {
      const pointsEarned = Number(payAmount / paisePerPoint);
      if (pointsEarned > 0) {
        await prisma.customer.update({
          where: { id: order.customerId },
          data: { loyaltyPoints: { increment: pointsEarned } },
        }).catch(() => undefined);
        await prisma.loyalty_accounts.upsert({
          where: { customer_id: order.customerId },
          update: { balance: { increment: pointsEarned }, updated_at: new Date() },
          create: {
            customer_id: order.customerId,
            balance: pointsEarned,
            tier: "SILVER",
          },
        }).catch(() => undefined);
      }
    }
  }

  await enqueueOutbox(prisma, outletId, "order.settled", {
    orderId,
    invoiceNumber: invoice.invoiceNumber,
    paymentMethod: payMethod || null,
    amountMinor: payAmount.toString(),
  });

  import("../websockets").then(({ broadcast }) => {
    broadcast("finance.order_settled", {
      orderId,
      outletId,
      paymentMethod: payMethod,
      amountMinor: payAmount.toString(),
      invoiceNumber: invoice!.invoiceNumber,
    });
    broadcast("table.status_updated", {
      tableId: order.diningTableId,
      orderId,
      status: "VACANT",
    });
    for (const id of dissolved.ids) {
      if (id !== order.diningTableId) {
        broadcast("table.status_updated", { tableId: id, orderId, status: "VACANT" });
      }
    }
    if (dissolved.ids.length > 0) {
      broadcast("table.unmerged", { tableIds: dissolved.ids, orderId });
    }
    if (bom.deductedCount > 0) {
      broadcast("inventory.stock_updated", { orderId, deductedCount: bom.deductedCount });
    }
  }).catch(() => undefined);

  return {
    ok: true,
    orderId,
    status: "COMPLETED",
    invoiceNumber: invoice.invoiceNumber,
    alreadySettled: false,
  };
}
