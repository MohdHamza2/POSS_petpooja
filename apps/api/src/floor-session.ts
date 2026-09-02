export type FloorWindow = {
  dayStart: Date;
  overnightCookCutoff: Date;
};

const COOKING_ORDER_STATUSES = new Set([
  "DRAFT",
  "PLACED",
  "CONFIRMED",
  "KOT_CREATED",
  "IN_PREPARATION",
  "READY",
]);

export function isLiveFloorSession(order: any, window?: FloorWindow): boolean {
  if (order.orderType && order.orderType !== "DINE_IN") return false;
  if (order.scheduledFireAt) return false;
  if (order.advanceStatus === "HELD" || order.advanceStatus === "SCHEDULED") return false;
  if (order.status === "COMPLETED" || order.status === "CANCELLED" || order.status === "FAILED") {
    return false;
  }

  const kots = order.kotTickets || [];
  const items = order.orderItems || [];
  const unserved = kots.some(
    (k: any) => k.status !== "CANCELLED" && k.status !== "SERVED"
  );

  let live = false;
  if (unserved) live = true;
  else if (kots.some((k: any) => k.status !== "CANCELLED")) live = true;
  else if (order.status === "DRAFT" && items.length > 0) live = true;
  else if (order.status === "SERVED" || order.status === "HANDED_OVER") live = true;
  if (!live) return false;
  if (!window) return true;

  const created = new Date(order.createdAt);
  if (Number.isNaN(created.getTime())) return true;
  if (created >= window.dayStart) return true;
  if (created >= window.overnightCookCutoff && COOKING_ORDER_STATUSES.has(String(order.status))) {
    return true;
  }
  return false;
}
