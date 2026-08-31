// Contract for services/orders. Order state machine per source doc §6.2 and
// docs/workflows/WF-ORD-order-lifecycle.md. Maps to kapmeta/schema.prisma
// Order, OrderItem, OrderItemModifier, OrderStatusHistory.

export type OrderStatus =
  | "DRAFT"
  | "PLACED"
  | "CONFIRMED"
  | "KOT_CREATED"
  | "IN_PREPARATION"
  | "READY"
  | "ASSIGNED"
  | "OUT_FOR_DELIVERY"
  | "SERVED"
  | "HANDED_OVER"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED";

export type OrderType = "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "AGGREGATOR";

// Legal forward transitions. Status history is append-only — a transition not
// in this map is rejected, never silently allowed. CANCELLED is reachable
// from every non-terminal state (cancellation workflow handles the reason/
// permission check before calling transition, not encoded in this table).
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ["PLACED", "CANCELLED"],
  PLACED: ["CONFIRMED", "CANCELLED", "FAILED"],
  CONFIRMED: ["KOT_CREATED", "CANCELLED"],
  KOT_CREATED: ["IN_PREPARATION", "CANCELLED"],
  IN_PREPARATION: ["READY", "CANCELLED"],
  READY: ["ASSIGNED", "HANDED_OVER", "SERVED", "CANCELLED"], // dine-in/pickup skip ASSIGNED
  ASSIGNED: ["OUT_FOR_DELIVERY", "CANCELLED"],
  OUT_FOR_DELIVERY: ["HANDED_OVER", "CANCELLED"],
  SERVED: ["COMPLETED", "CANCELLED"],
  HANDED_OVER: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  FAILED: [],
};

export interface OrderLineInput {
  menuItemId: string;
  quantity: number;
  modifierOptionIds: string[];
  notes?: string;
  course?: string; // STARTER, MAIN, DESSERT, BEVERAGE — course-wise firing tag
  seatNumber?: number; // for split-by-seat billing
}

export interface CreateOrderInput {
  outletId: string;
  terminalNumber: string;
  orderType: OrderType;
  idempotencyKey: string; // client-generated, per DEC-002 offline enablers
  lines: OrderLineInput[];
  customerId?: string;
  diningTableId?: string;
  waiterId?: string;
}

export interface PricedOrderLineModifier {
  modifierOptionId: string;
  priceMinor: bigint; // modifier's price at time of order (audit trail)
}

export interface PricedOrderLine {
  menuItemId: string;
  quantity: number;
  unitPriceMinor: bigint;
  subtotalMinor: bigint;
  taxMinor: bigint;
  modifiers: PricedOrderLineModifier[];
  course?: string;
  seatNumber?: number;
  notes?: string;
}

export interface PricedOrder {
  subtotalMinor: bigint;
  taxTotalMinor: bigint;
  grandTotalMinor: bigint;
  lines: PricedOrderLine[];
}

export type TransitionResult =
  | { ok: true; newStatus: OrderStatus }
  | { ok: false; reason: "ILLEGAL_TRANSITION"; from: OrderStatus; to: OrderStatus };

export function isTransitionLegal(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}
