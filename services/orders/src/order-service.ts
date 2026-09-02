import { isTransitionLegal } from "@kapmeta/shared-types/orders";
import type {
  OrderStatus,
  CreateOrderInput,
  OrderLineInput,
  PricedOrder,
  PricedOrderLine,
  PricedOrderLineModifier,
  TransitionResult,
} from "@kapmeta/shared-types/orders";

export interface MenuPriceLookup {
  // taxRatePercent is the item's inclusive GST rate (MenuItem.taxRate,
  // e.g. 5 for 5%) — the price is already tax-inclusive, so this is used to
  // back out the tax component for invoice/Finance reporting, not to add
  // anything on top of the charged price.
  getPrice(menuItemId: string, outletId: string): Promise<{ priceMinor: bigint; taxRatePercent: number } | null>;
}

export interface ModifierPriceLookup {
  // Batch lookup: returns a map of modifierOptionId -> priceMinor for every
  // id that resolves to an active option at this outlet. Ids not present in
  // the returned map are treated as unresolvable by priceOrder.
  getPrices(modifierOptionIds: string[], outletId: string): Promise<Map<string, bigint>>;
}

export interface OrderRepository {
  // Gapless, outlet-scoped, per-day order number (e.g. "20260810-0007") —
  // atomic at the DB level so two concurrent checkouts can't collide.
  nextOrderNumber(outletId: string): Promise<string>;
  findByIdempotencyKey(idempotencyKey: string): Promise<{ id: string; status: OrderStatus } | null>;
  createOrder(
    id: string,
    input: CreateOrderInput,
    priced: PricedOrder,
    orderNumber: string
  ): Promise<{ id: string; status: OrderStatus }>;
  getStatus(orderId: string): Promise<OrderStatus | null>;
  recordTransition(orderId: string, newStatus: OrderStatus, userId: string, reasonCode?: string, approverUserId?: string): Promise<void>;
  listOrders(outletId: string, filter: ListOrdersFilter): Promise<OrderSummary[]>;
  countOrders(outletId: string, filter: ListOrdersFilter): Promise<number>;
  getRevenueTrend(outletId: string, fromDate: Date, toDate: Date): Promise<RevenueTrendPoint[]>;
  getOrderDetail(outletId: string, orderId: string): Promise<OrderDetail | null>;
  getLiveOrderByTable(outletId: string, diningTableId: string): Promise<{ id: string } | null>;
  addItems(
    outletId: string,
    orderId: string,
    priced: PricedOrder,
    userId: string
  ): Promise<{ id: string; menuItemId: string; quantity: number }[]>;
  voidItem(
    outletId: string,
    orderId: string,
    orderItemId: string,
    reasonCode: string,
    userId: string
  ): Promise<{ ok: boolean }>;
  getBill(outletId: string, orderId: string): Promise<BillSummary | null>;
  getBillBySeat(outletId: string, orderId: string): Promise<{ seatNumber: number | null; subtotalMinor: string; paidMinor: string }[]>;
  setCharges(
    outletId: string,
    orderId: string,
    tipMinor: bigint,
    serviceChargeMinor: bigint
  ): Promise<{ tipTotalMinor: bigint; serviceChargeTotalMinor: bigint; grandTotalMinor: bigint }>;
  recordPayment(
    outletId: string,
    orderId: string,
    amountMinor: bigint,
    method: string,
    userId: string,
    seatNumber?: number
  ): Promise<{ id: string; amountMinor: bigint; method: string; status: string }>;
}

export interface BillSummary {
  orderId: string;
  orderNumber: string;
  subtotalMinor: bigint;
  discountTotalMinor: bigint;
  taxTotalMinor: bigint;
  tipTotalMinor: bigint;
  serviceChargeTotalMinor: bigint;
  grandTotalMinor: bigint;
  paidMinor: bigint;
  dueMinor: bigint;
}

// Statuses with no legal outgoing transition per ORDER_TRANSITIONS
// (@kapmeta/shared-types/orders) — i.e. the order is done, one way or
// another. Everything else is "live" (in progress).
export const TERMINAL_ORDER_STATUSES: OrderStatus[] = ["COMPLETED", "CANCELLED", "FAILED"];

export interface ListOrdersFilter {
  // "live" = non-terminal statuses (Live Orders tab). "online" = DELIVERY
  // (Direct plus aggregator-numbered). "all" = no status/type narrowing, but
  // fromDate/toDate still apply (All Orders tab date range).
  view?: "live" | "online" | "all";
  status?: OrderStatus;
  orderType?: string;
  orderNumberSearch?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  orderType: string;
  status: OrderStatus;
  grandTotalMinor: bigint;
  taxTotalMinor: bigint;
  discountTotalMinor: bigint;
  createdAt: Date;
  itemCount: number;
  diningTableId: string | null;
  channel: string | null;
  externalOrderId: string | null;
  priceMismatch: boolean;
  customerName: string | null;
  waiterName: string | null;
  paymentMethod: string | null;
}

export interface RevenueTrendPoint {
  date: string; // YYYY-MM-DD
  grandTotalMinor: string;
}

export interface OrderDetail extends OrderSummary {
  subtotalMinor: bigint;
  taxTotalMinor: bigint;
  discountTotalMinor: bigint;
  terminalNumber: string;
  diningTableId: string | null;
  customerId: string | null;
  customerPhone: string | null;
  items: {
    id: string;
    menuItemId: string;
    menuItemName: string;
    quantity: number;
    unitPriceMinor: bigint;
    subtotalMinor: bigint;
    notes: string | null;
    isVoided: boolean;
    course: string | null;
    seatNumber: number | null;
    modifiers: { modifierOptionId: string; priceMinor: bigint }[];
  }[];
  payments: {
    id: string;
    amountMinor: bigint;
    method: string;
    status: string;
    transactionId: string | null;
    createdAt: Date;
  }[];
  statusHistory: { status: OrderStatus; notes: string | null; createdAt: Date; createdBy: string | null }[];
}

export function priceOrder(
  lines: OrderLineInput[],
  prices: Map<string, { priceMinor: bigint; taxRatePercent: number }>,
  modifierPrices: Map<string, bigint> = new Map()
): PricedOrder {
  const pricedLines: PricedOrderLine[] = [];
  let subtotalMinor = 0n;
  let taxTotalMinor = 0n;

  for (const line of lines) {
    const priceInfo = prices.get(line.menuItemId);
    if (priceInfo === undefined) {
      throw new Error(`no price found for menu item ${line.menuItemId}`);
    }
    const { priceMinor: unitPriceMinor, taxRatePercent } = priceInfo;

    // Modifier surcharges are captured per unit (same convention as
    // unitPriceMinor) and scaled by line quantity, matching how the base
    // item price is scaled below.
    let modifierSurchargeUnitMinor = 0n;
    const modifiers: PricedOrderLineModifier[] = [];
    for (const modifierOptionId of (line.modifierOptionIds || [])) {
      const modifierPriceMinor = modifierPrices.get(modifierOptionId);
      if (modifierPriceMinor === undefined) {
        throw new Error(`no price found for modifier option ${modifierOptionId}`);
      }
      modifierSurchargeUnitMinor += modifierPriceMinor;
      modifiers.push({ modifierOptionId, priceMinor: modifierPriceMinor });
    }

    const unitPrice = BigInt(unitPriceMinor ?? 0);
    const surcharge = BigInt(modifierSurchargeUnitMinor ?? 0);
    const qty = BigInt(line.quantity ?? 1);
    const lineSubtotalMinor = (unitPrice + surcharge) * qty;

    const rate = Number(taxRatePercent ?? 5);
    const taxRateBasisPoints = BigInt(Math.round(rate * 100));
    const lineTaxMinor = lineSubtotalMinor - (lineSubtotalMinor * 10000n) / (10000n + taxRateBasisPoints);

    pricedLines.push({
      menuItemId: line.menuItemId,
      quantity: Number(line.quantity ?? 1),
      unitPriceMinor: unitPrice,
      subtotalMinor: lineSubtotalMinor,
      taxMinor: lineTaxMinor,
      modifiers,
      course: line.course,
      seatNumber: line.seatNumber,
      notes: line.notes,
    });
    subtotalMinor += lineSubtotalMinor;
    taxTotalMinor += lineTaxMinor;
  }

  // Tax is inclusive, not additive — it's already inside subtotalMinor, so
  // grand total is still just subtotal minus discount (applied elsewhere).
  // taxTotalMinor exists purely to report the CGST+SGST breakdown correctly
  // on the invoice and Finance ledger (was hardcoded to 0 before — DEC-004).
  return {
    subtotalMinor,
    taxTotalMinor,
    grandTotalMinor: subtotalMinor,
    lines: pricedLines,
  };
}

async function deductBOMForOrder(orderId: string, orderRepo: OrderRepository): Promise<void> {
  // Fetch order detail to get menu items + quantities
  const orderDetail = await (orderRepo as any).getOrderById?.(orderId);
  if (!orderDetail || !orderDetail.lines) return;

  const outletId = orderDetail.outletId;
  if (!outletId) return;

  // Group by menuItemId
  const itemQtyMap = new Map<string, number>();
  for (const line of orderDetail.lines) {
    const curr = itemQtyMap.get(line.menuItemId) || 0;
    itemQtyMap.set(line.menuItemId, curr + (line.quantity || 1));
  }

  // For each menu item with a recipe, deduct ingredients
  const prisma = (orderRepo as any).prisma;
  if (!prisma) return;

  for (const [menuItemId, qty] of itemQtyMap.entries()) {
    const recipe = await prisma.recipes.findFirst({
      where: { outlet_id: outletId, menu_item_id: menuItemId, is_active: true },
      include: { recipe_ingredients: true },
    });
    if (!recipe || !recipe.recipe_ingredients.length) continue;

    const portions = Number(recipe.yield_portions || 1);
    for (const ri of recipe.recipe_ingredients) {
      const deductQty = (Number(ri.quantity) / portions) * qty;
      await prisma.ingredients.updateMany({
        where: { id: ri.ingredient_id, outlet_id: outletId },
        data: {
          current_stock_qty: { decrement: deductQty },
          updated_at: new Date(),
        },
      });
    }
  }
}

export async function createOrder(
  input: CreateOrderInput,
  menuPriceLookup: MenuPriceLookup,
  orderRepo: OrderRepository,
  modifierPriceLookup?: ModifierPriceLookup
): Promise<{ id: string; status: OrderStatus; alreadyExisted: boolean }> {
  const existing = await orderRepo.findByIdempotencyKey(input.idempotencyKey);
  if (existing) {
    return { id: existing.id, status: existing.status, alreadyExisted: true };
  }

  const prices = new Map<string, { priceMinor: bigint; taxRatePercent: number }>();
  for (const line of input.lines) {
    const price = await menuPriceLookup.getPrice(line.menuItemId, input.outletId);
    if (!price) {
      throw new Error(`no price found for menu item ${line.menuItemId}`);
    }
    prices.set(line.menuItemId, price);
  }

  const modifierOptionIds = Array.from(
    new Set(input.lines.flatMap((line) => line.modifierOptionIds))
  );
  const modifierPrices =
    modifierOptionIds.length > 0 && modifierPriceLookup
      ? await modifierPriceLookup.getPrices(modifierOptionIds, input.outletId)
      : new Map<string, bigint>();

  const priced = priceOrder(input.lines, prices, modifierPrices);

  const id = crypto.randomUUID();
  const orderNumber = await orderRepo.nextOrderNumber(input.outletId);

  const result = await orderRepo.createOrder(id, input, priced, orderNumber);
  return { id: result.id, status: result.status, alreadyExisted: false };
}

export async function transitionOrder(
  orderId: string,
  toStatus: OrderStatus,
  orderRepo: OrderRepository,
  userId: string,
  reasonCode?: string,
  approverUserId?: string
): Promise<TransitionResult> {
  const currentStatus = await orderRepo.getStatus(orderId);
  if (currentStatus === null) {
    // Known shape limitation: TransitionResult has no NOT_FOUND variant,
    // so a missing order reuses ILLEGAL_TRANSITION with from: "FAILED".
    return { ok: false, reason: "ILLEGAL_TRANSITION", from: "FAILED", to: toStatus };
  }

  if (!isTransitionLegal(currentStatus, toStatus)) {
    return { ok: false, reason: "ILLEGAL_TRANSITION", from: currentStatus, to: toStatus };
  }

  await orderRepo.recordTransition(orderId, toStatus, userId, reasonCode, approverUserId);

  // BOM deduction: when order completed, consume recipe ingredients
  if (toStatus === "COMPLETED") {
    try {
      await deductBOMForOrder(orderId, orderRepo);
    } catch (error) {
      console.error("BOM deduction failed for order", orderId, error);
      // Non-fatal: order already marked completed, log and continue
    }
  }

  return { ok: true, newStatus: toStatus };
}

export async function listOrders(
  outletId: string,
  filter: ListOrdersFilter,
  orderRepo: OrderRepository
): Promise<OrderSummary[]> {
  return orderRepo.listOrders(outletId, filter);
}

export async function countOrders(
  outletId: string,
  filter: ListOrdersFilter,
  orderRepo: OrderRepository
): Promise<number> {
  return orderRepo.countOrders(outletId, filter);
}

export async function getRevenueTrend(
  outletId: string,
  fromDate: Date,
  toDate: Date,
  orderRepo: OrderRepository
): Promise<RevenueTrendPoint[]> {
  return orderRepo.getRevenueTrend(outletId, fromDate, toDate);
}

export async function getOrderDetail(
  outletId: string,
  orderId: string,
  orderRepo: OrderRepository
): Promise<OrderDetail | null> {
  return orderRepo.getOrderDetail(outletId, orderId);
}

export async function getLiveOrderByTable(
  outletId: string,
  diningTableId: string,
  orderRepo: OrderRepository
): Promise<{ id: string } | null> {
  return orderRepo.getLiveOrderByTable(outletId, diningTableId);
}

export async function addOrderItems(
  outletId: string,
  orderId: string,
  lines: OrderLineInput[],
  menuPriceLookup: MenuPriceLookup,
  orderRepo: OrderRepository,
  userId: string,
  modifierPriceLookup?: ModifierPriceLookup
): Promise<{ id: string; menuItemId: string; quantity: number }[]> {
  const prices = new Map<string, { priceMinor: bigint; taxRatePercent: number }>();
  for (const line of lines) {
    const price = await menuPriceLookup.getPrice(line.menuItemId, outletId);
    if (!price) {
      throw new Error(`no price found for menu item ${line.menuItemId}`);
    }
    prices.set(line.menuItemId, price);
  }

  const modifierOptionIds = Array.from(
    new Set(
      lines.flatMap((line) => (Array.isArray(line.modifierOptionIds) ? line.modifierOptionIds : [])).filter(Boolean)
    )
  );
  const modifierPrices =
    modifierOptionIds.length > 0 && modifierPriceLookup
      ? await modifierPriceLookup.getPrices(modifierOptionIds, outletId)
      : new Map<string, bigint>();

  const priced = priceOrder(lines, prices, modifierPrices);
  return orderRepo.addItems(outletId, orderId, priced, userId);
}

export async function voidOrderItem(
  outletId: string,
  orderId: string,
  orderItemId: string,
  reasonCode: string,
  userId: string,
  orderRepo: OrderRepository
): Promise<{ ok: boolean }> {
  return orderRepo.voidItem(outletId, orderId, orderItemId, reasonCode, userId);
}

export async function getBill(outletId: string, orderId: string, orderRepo: OrderRepository): Promise<BillSummary | null> {
  return orderRepo.getBill(outletId, orderId);
}

export async function getBillBySeat(
  outletId: string,
  orderId: string,
  orderRepo: OrderRepository
): Promise<{ seatNumber: number | null; subtotalMinor: string; paidMinor: string }[]> {
  return orderRepo.getBillBySeat(outletId, orderId);
}

export async function setOrderCharges(
  outletId: string,
  orderId: string,
  tipMinor: bigint,
  serviceChargeMinor: bigint,
  orderRepo: OrderRepository
): Promise<{ tipTotalMinor: bigint; serviceChargeTotalMinor: bigint; grandTotalMinor: bigint }> {
  return orderRepo.setCharges(outletId, orderId, tipMinor, serviceChargeMinor);
}

export async function recordPayment(
  outletId: string,
  orderId: string,
  amountMinor: bigint,
  method: string,
  orderRepo: OrderRepository,
  userId: string,
  seatNumber?: number
): Promise<{ id: string; amountMinor: bigint; method: string; status: string }> {
  return orderRepo.recordPayment(outletId, orderId, amountMinor, method, userId, seatNumber);
}
