import type { PrismaClient } from "@prisma/client";
import { createKot, PrismaKotRepository } from "@kapmeta/kitchen";
import { stampOrderMergeLabel } from "./table-merge";

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
    await createKot(
      {
        outletId: order.outletId,
        orderId: order.id,
        lines: newLines.map((item) => ({
          menuItemId: item.menuItemId,
          quantity: Number(item.quantity) || 1,
          notes: item.notes ?? undefined,
          course: item.course ?? undefined,
          orderItemId: item.id,
        })),
      },
      new PrismaKotRepository(prisma),
    );
    if (order.diningTableId) {
      await stampOrderMergeLabel(prisma, order.outletId, order.id, order.diningTableId);
    }
    const table = order.diningTableId
      ? await prisma.diningTable.findFirst({
          where: { id: order.diningTableId },
          select: { tableNumber: true, mergeGroupId: true, mergePrimaryTableId: true },
        })
      : null;
    import("../websockets").then(({ broadcast }) => {
      broadcast("kot.created", {
        orderId: order.id,
        diningTableId: order.diningTableId,
        tableNumber: table?.tableNumber || null,
      });
      if (order.diningTableId) {
        broadcast("order.updated", { orderId: order.id, diningTableId: order.diningTableId });
        broadcast("table.status_updated", { tableId: order.diningTableId, orderId: order.id, status: "OCCUPIED" });
      }
    }).catch(() => {});
  } catch (err) {
    console.error(`onOrderConfirmed: KOT creation failed for order ${orderId}`, err);
  }
}

export async function onItemsAdded(orderId: string, prisma: PrismaClient): Promise<void> {
  return onOrderConfirmed(orderId, prisma);
}
