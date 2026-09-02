import type { PrismaClient } from "@prisma/client";
import { transitionOrder, PrismaOrderRepository } from "@kapmeta/orders";
import type { OrderStatus } from "@kapmeta/shared-types/orders";
import { deductBomStockForOrder } from "./inventory-depletion";
import { dissolveMergeGroupForTable } from "./table-merge";
import { cascadeKotTicketsTo } from "./order-lifecycle";

export interface SettleOrderInput {
  outletId: string;
  orderId: string;
  userId: string;
  paymentMethod?: string;
  amountPaidMinor?: bigint | string | number;
  payments?: { method: string; amountMinor: bigint | string | number }[];
  customerId?: string;
}

export interface SettleOrderResult {
  ok: true;
  orderId: string;
  status: string;
  invoiceNumber: string;
  invoiceNumbers: string[];
  alreadySettled: boolean;
}

const DINE_CHAIN: OrderStatus[] = [
  "CONFIRMED",
  "KOT_CREATED",
  "IN_PREPARATION",
  "READY",
  "SERVED",
  "HANDED_OVER",
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

async function orderHasUnservedKot(prisma: PrismaClient, orderId: string): Promise<boolean> {
  const n = await prisma.kOTTicket.count({
    where: { orderId, status: { notIn: ["SERVED", "CANCELLED"] } },
  });
  return n > 0;
}

async function cascadeKitchenOnSettle(
  prisma: PrismaClient,
  orderId: string,
  userId: string
): Promise<boolean> {
  const kotCascade = await cascadeKotTicketsTo(prisma, orderId, "SERVED", userId);
  // #region agent log
  fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'OCC3',location:'settle-order.ts:kot-cascade',message:'settle cascaded kitchen tickets',data:{orderId,kotTarget:kotCascade.target,kotCount:kotCascade.ticketIds.length,from:kotCascade.from},timestamp:Date.now(),runId:'occ-post'})}).catch(()=>{});
  // #endregion
  return orderHasUnservedKot(prisma, orderId);
}

async function writeInvoicesForPayments(
  prisma: PrismaClient,
  outletId: string,
  orderId: string,
  grandTotal: bigint,
  taxTotal: bigint
) {
  const existing = await prisma.invoice.findMany({
    where: { orderId },
    orderBy: { splitIndex: "asc" },
  });
  if (existing.length > 0) return existing;

  const recorded = await prisma.payment.findMany({
    where: { orderId, outletId, status: "CAPTURED" },
    orderBy: { createdAt: "asc" },
  });
  const slices = recorded.length > 0
    ? recorded.map((p) => p.amount)
    : [grandTotal];

  const created = [];
  let taxAllocated = 0n;
  for (let i = 0; i < slices.length; i++) {
    const isLast = i === slices.length - 1;
    const amount = slices[i];
    const tax = isLast
      ? taxTotal - taxAllocated
      : (grandTotal > 0n ? (taxTotal * amount) / grandTotal : 0n);
    taxAllocated += tax;
    const invoiceNumber = await nextInvoiceNumber(prisma, outletId);
    created.push(await prisma.invoice.create({
      data: {
        outletId,
        orderId,
        splitIndex: i,
        invoiceNumber,
        amountMinor: amount,
        taxAmountMinor: tax < 0n ? 0n : tax,
      },
    }));
  }
  return created;
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

  const existingInvoices = await prisma.invoice.findMany({
    where: { orderId },
    orderBy: { splitIndex: "asc" },
  });
  if (order.settledAt && existingInvoices.length > 0) {
    const err = new Error("ALREADY_SETTLED");
    (err as Error & { code?: string }).code = "ALREADY_SETTLED";
    throw err;
  }
  if (order.status === "COMPLETED") {
    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'B',location:'settle-order.ts:alreadySettled',message:'settle hit COMPLETED branch',data:{orderId,settledAt:order.settledAt?true:false,hasInvoice:existingInvoices.length>0,invoiceCount:existingInvoices.length,tableId:order.diningTableId||null,tableNumber:order.table_number||null},timestamp:Date.now(),runId:'post-fix'})}).catch(()=>{});
    // #endregion

    const existingPays = await prisma.payment.findMany({
      where: { orderId, outletId, status: "CAPTURED" },
    });
    const alreadyPaid = existingPays.reduce((sum, p) => sum + p.amount, 0n);
    const invoices = existingInvoices.length > 0
      ? existingInvoices
      : await writeInvoicesForPayments(prisma, outletId, orderId, order.grandTotal, order.taxTotal ?? 0n);
    const invoice = invoices[0];
    if (!order.settledAt) {
      await prisma.order.update({
        where: { id: orderId },
        data: { settledAt: new Date() },
      });
    }
    const cooking = await cascadeKitchenOnSettle(prisma, orderId, userId);
    const dissolved = cooking
      ? { ids: [] as string[], numbers: [] as string[] }
      : (order.diningTableId
        ? await dissolveMergeGroupForTable(prisma, outletId, order.diningTableId)
        : { ids: [] as string[], numbers: [] as string[] });
    if (!cooking && dissolved.ids.length === 0 && order.table_number) {
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
      if (!cooking) {
        const vacantIds = dissolved.ids.length > 0
          ? dissolved.ids
          : (order.diningTableId ? [order.diningTableId] : []);
        for (const id of vacantIds) {
          broadcast("table.status_updated", { tableId: id, orderId, status: "VACANT" });
        }
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
      invoiceNumbers: invoices.map((inv) => inv.invoiceNumber),
      alreadySettled: true,
    };
  }
  if (order.status === "CANCELLED" || order.status === "FAILED") {
    throw new Error(`Cannot settle order in status ${order.status}`);
  }

  if (input.customerId && !order.customerId) {
    await prisma.order.update({
      where: { id: orderId },
      data: { customerId: input.customerId },
    });
    order.customerId = input.customerId;
  }

  const isOffFloor = order.orderType !== "DINE_IN";
  const statusChain = isOffFloor ? TAKEAWAY_CHAIN : DINE_CHAIN;
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
    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'B',location:'settle-order.ts:recordChunk',message:'settle recording payment chunk',data:{orderId,method:p.method,chunk:chunk.toString(),remainingToRecord:remainingToRecord.toString(),grandTotal:order.grandTotal.toString()},timestamp:Date.now(),runId:'hotel-p0'})}).catch(()=>{});
    // #endregion
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

  const preexistingCash = existingPays
    .filter((p) => String(p.method).toUpperCase() === "CASH")
    .reduce((sum, p) => sum + p.amount, 0n);
  if (preexistingCash > 0n) {
    const activeDrawer = await prisma.cash_drawer_sessions.findFirst({
      where: { outlet_id: outletId, status: "OPEN" },
      orderBy: { opened_at: "desc" },
    });
    if (activeDrawer) {
      await prisma.cash_drawer_sessions.update({
        where: { id: activeDrawer.id },
        data: {
          expected_close_balance_minor: { increment: preexistingCash },
          updated_at: new Date(),
        },
      });
    }
  }

  const invoices = await writeInvoicesForPayments(
    prisma,
    outletId,
    orderId,
    order.grandTotal,
    order.taxTotal ?? 0n
  );
  const invoice = invoices[0];
  const invoiceSum = invoices.reduce((s, inv) => s + inv.amountMinor, 0n);
  const invoiceTaxSum = invoices.reduce((s, inv) => s + inv.taxAmountMinor, 0n);
  // #region agent log
  fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'A',location:'settle-order.ts:invoice-write',message:'invoice vs payments after settle',data:{orderId,paymentInputCount:splitPays.length,invoiceCount:invoices.length,invoiceNumbers:invoices.map((inv) => inv.invoiceNumber),invoiceAmounts:invoices.map((inv) => inv.amountMinor.toString()),grandTotal:order.grandTotal.toString()},timestamp:Date.now(),runId:'split-post'})}).catch(()=>{});
  fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'T2',location:'settle-order.ts:sync-totals',message:'sync order totals to invoices',data:{orderId,grandBefore:order.grandTotal.toString(),invoiceSum:invoiceSum.toString(),invoiceTaxSum:invoiceTaxSum.toString(),willSyncTotals:invoiceSum!==order.grandTotal},timestamp:Date.now(),runId:'tax-fix'})}).catch(()=>{});
  // #endregion

  await prisma.order.update({
    where: { id: orderId },
    data: {
      settledAt: new Date(),
      grandTotal: invoiceSum,
      subtotal: invoiceSum,
      taxTotal: invoiceTaxSum,
      ...(order.created_by ? {} : { created_by: userId }),
    },
  });

  const cooking = await cascadeKitchenOnSettle(prisma, orderId, userId);
  const dissolved = cooking
    ? { ids: [] as string[], numbers: [] as string[] }
    : (order.diningTableId
      ? await dissolveMergeGroupForTable(prisma, outletId, order.diningTableId)
      : { ids: [] as string[], numbers: [] as string[] });
  if (!cooking && dissolved.ids.length === 0 && order.table_number) {
    await prisma.diningTable.updateMany({
      where: { outletId, tableNumber: order.table_number },
      data: { status: "VACANT", mergeGroupId: null, mergePrimaryTableId: null },
    });
  }

  const bom = await deductBomStockForOrder(orderId, outletId, prisma, userId, "ORDER_SETTLED");
  // #region agent log
  fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'H',location:'settle-order.ts:loyalty',message:'loyalty branch',data:{orderId,hasCustomerId:Boolean(order.customerId),payAmount:payAmount.toString(),grandTotal:order.grandTotal.toString(),bomDeducted:bom.deductedCount,bomSkipped:bom.skippedDuplicate,paisePerPoint:null,runId:'serve-bom'},timestamp:Date.now(),runId:'serve-bom'})}).catch(()=>{});
  // #endregion

  if (order.customerId) {
    const outlet = await prisma.outlet.findUnique({ where: { id: outletId } });
    const paisePerPoint = outlet?.loyaltyPaisePerPoint;
    const loyaltyBase = invoiceSum;
    const pointsEarned = paisePerPoint && paisePerPoint > 0n ? Number(loyaltyBase / paisePerPoint) : 0;
    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'H',location:'settle-order.ts:loyalty-award',message:'loyalty award',data:{orderId,customerId:order.customerId,paisePerPoint:paisePerPoint!=null?paisePerPoint.toString():null,loyaltyBase:loyaltyBase.toString(),pointsEarned},timestamp:Date.now(),runId:'post-fix'})}).catch(()=>{});
    // #endregion
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
    if (!cooking) {
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
    invoiceNumbers: invoices.map((inv) => inv.invoiceNumber),
    alreadySettled: false,
  };
}
