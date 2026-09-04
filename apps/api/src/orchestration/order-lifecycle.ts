import type { PrismaClient } from "@prisma/client";
import { createKot, PrismaKotRepository, transitionKot } from "@kapmeta/kitchen";
import { transitionOrder, PrismaOrderRepository } from "@kapmeta/orders";
import { ORDER_TRANSITIONS, type OrderStatus } from "@kapmeta/shared-types/orders";
import type { KotStatus } from "@kapmeta/shared-types/kitchen";
import { stampOrderMergeLabel } from "./table-merge";

function shortestLegalPath(from: OrderStatus, to: OrderStatus): OrderStatus[] | null {
  if (from === to) return [];
  const queue: OrderStatus[][] = [[from]];
  const seen = new Set<OrderStatus>([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const last = path[path.length - 1];
    for (const next of ORDER_TRANSITIONS[last] || []) {
      if (seen.has(next) || next === "CANCELLED" || next === "FAILED") continue;
      const nextPath = [...path, next];
      if (next === to) return nextPath.slice(1);
      seen.add(next);
      queue.push(nextPath);
    }
  }
  return null;
}

/** Walk the legal order state machine from current status to target. Kitchen KOT
 *  cascades used to call transitionOrder once (CONFIRMED → HANDED_OVER) which is
 *  illegal and was swallowed, leaving aggregator/delivery orders stuck. */
export async function stepOrderTo(
  prisma: PrismaClient,
  orderId: string,
  toStatus: OrderStatus,
  userId: string
): Promise<{ ok: boolean; from: OrderStatus | null; applied: OrderStatus[] }> {
  const orderRepo = new PrismaOrderRepository(prisma);
  const from = (await orderRepo.getStatus(orderId)) as OrderStatus | null;
  if (from === null) return { ok: false, from: null, applied: [] };
  if (from === toStatus) return { ok: true, from, applied: [] };
  const path = shortestLegalPath(from, toStatus);
  if (!path || path.length === 0) {
    const direct = await transitionOrder(orderId, toStatus, orderRepo, userId);
    return { ok: direct.ok, from, applied: direct.ok ? [toStatus] : [] };
  }
  const applied: OrderStatus[] = [];
  for (const step of path) {
    const result = await transitionOrder(orderId, step, orderRepo, userId);
    if (!result.ok) return { ok: false, from, applied };
    applied.push(step);
  }
  return { ok: true, from, applied };
}

const KOT_WALK: Record<"READY" | "SERVED", Record<string, KotStatus[]>> = {
  READY: {
    QUEUED: ["PREPARING", "READY"],
    PREPARING: ["READY"],
    READY: [],
  },
  SERVED: {
    QUEUED: ["PREPARING", "READY", "SERVED"],
    PREPARING: ["READY", "SERVED"],
    READY: ["SERVED"],
  },
};

/** Walk each live KOT ticket to READY/SERVED so aggregator Mark Ready / Dispatch
 *  matches kitchen KDS. CANCELLED uses updateMany like POST /orders/:id/cancel. */
export async function cascadeKotTicketsTo(
  prisma: PrismaClient,
  orderId: string,
  target: "READY" | "SERVED" | "CANCELLED",
  userId: string
): Promise<{ ticketIds: string[]; from: string[]; target: string }> {
  if (target === "CANCELLED") {
    const live = await prisma.kOTTicket.findMany({
      where: { orderId, status: { not: "CANCELLED" } },
      select: { id: true, status: true },
    });
    await prisma.kOTTicket.updateMany({
      where: { orderId, status: { not: "CANCELLED" } },
      data: { status: "CANCELLED", updatedAt: new Date() },
    });
    return { ticketIds: live.map((t) => t.id), from: live.map((t) => t.status), target };
  }

  const tickets = await prisma.kOTTicket.findMany({
    where: { orderId, status: { notIn: ["CANCELLED", "SERVED"] } },
    select: { id: true, status: true },
  });
  const repository = new PrismaKotRepository(prisma);
  const walked: string[] = [];
  const from = tickets.map((t) => t.status);
  for (const ticket of tickets) {
    const steps = KOT_WALK[target][ticket.status] || [];
    let ok = true;
    for (const step of steps) {
      const result = await transitionKot(ticket.id, step, repository, userId);
      if (!result.ok) {
        ok = false;
        break;
      }
    }
    if (ok) walked.push(ticket.id);
  }
  return { ticketIds: walked, from, target };
}

export async function onOrderConfirmed(orderId: string, prisma: PrismaClient): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { orderItems: true },
  });
  if (!order) {
    console.error(`onOrderConfirmed: order ${orderId} not found`);
    return;
  }

  const alreadyTicketed = await prisma.kOTItem.findMany({
    where: {
      kotTicket: { orderId },
      orderItemId: { not: null },
    },
    select: { orderItemId: true },
  });
  const ticketedIds = new Set(
    alreadyTicketed.map((row) => row.orderItemId).filter((id): id is string => Boolean(id))
  );

  const newLines = order.orderItems.filter((item) => !item.isVoided && !ticketedIds.has(item.id));
  if (newLines.length === 0) {
    return;
  }

  try {
    const kotRepo = new PrismaKotRepository(prisma);
    for (const item of newLines) {
      await createKot(
        {
          outletId: order.outletId,
          orderId: order.id,
          lines: [{
            menuItemId: item.menuItemId,
            quantity: Number(item.quantity) || 1,
            notes: item.notes ?? undefined,
            course: item.course ?? undefined,
            orderItemId: item.id,
          }],
        },
        kotRepo,
      );
    }
    const bindsTable = order.orderType === "DINE_IN" && Boolean(order.diningTableId) && !order.scheduledFireAt;
    if (bindsTable && order.diningTableId) {
      await stampOrderMergeLabel(prisma, order.outletId, order.id, order.diningTableId);
    }
    const table = bindsTable && order.diningTableId
      ? await prisma.diningTable.findFirst({
          where: { id: order.diningTableId },
          select: { tableNumber: true, mergeGroupId: true, mergePrimaryTableId: true },
        })
      : null;
    import("../websockets").then(({ broadcast }) => {
      broadcast("kot.created", {
        orderId: order.id,
        diningTableId: bindsTable ? order.diningTableId : null,
        tableNumber: table?.tableNumber || (order.orderType === "DELIVERY" ? "DELIVERY" : order.orderType === "PICKUP" ? "PICKUP" : null),
        ticketCount: newLines.length,
      });
      if (bindsTable && order.diningTableId) {
        broadcast("order.updated", { orderId: order.id, diningTableId: order.diningTableId });
        broadcast("table.status_updated", { tableId: order.diningTableId, orderId: order.id, status: "OCCUPIED" });
      }
    }).catch(err => console.error('Background task error:', err?.message || err));
  } catch (err) {
    console.error(`onOrderConfirmed: KOT creation failed for order ${orderId}`, err);
  }
}

export async function onItemsAdded(orderId: string, prisma: PrismaClient): Promise<void> {
  return onOrderConfirmed(orderId, prisma);
}
