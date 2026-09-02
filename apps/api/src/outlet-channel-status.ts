import { prisma } from "./prisma";

export type OutletOpsStatus = {
  isOnline: boolean;
  dineInActive: boolean;
  deliveryActive: boolean;
  pickupActive: boolean;
  updatedAt: string | null;
};

const DEFAULTS: OutletOpsStatus = {
  isOnline: true,
  dineInActive: true,
  deliveryActive: true,
  pickupActive: true,
  updatedAt: null,
};

export async function loadOutletOpsStatus(outletId: string): Promise<OutletOpsStatus> {
  const rows = await prisma.$queryRaw<
    Array<{
      is_online: boolean;
      dine_in_active: boolean;
      delivery_active: boolean;
      pickup_active: boolean;
      updated_at: Date | null;
    }>
  >`
    SELECT is_online,
           COALESCE(dine_in_active, true) AS dine_in_active,
           COALESCE(delivery_active, true) AS delivery_active,
           COALESCE(pickup_active, true) AS pickup_active,
           updated_at
    FROM outlet_status
    WHERE outlet_id = ${outletId}::uuid
  `;
  const row = rows[0];
  if (!row) return { ...DEFAULTS };
  return {
    isOnline: row.is_online !== false,
    dineInActive: row.dine_in_active !== false,
    deliveryActive: row.delivery_active !== false,
    pickupActive: row.pickup_active !== false,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
  };
}

export async function saveOutletOpsStatus(
  outletId: string,
  userId: string,
  patch: Partial<Pick<OutletOpsStatus, "isOnline" | "dineInActive" | "deliveryActive" | "pickupActive">>,
): Promise<OutletOpsStatus> {
  const current = await loadOutletOpsStatus(outletId);
  const next: OutletOpsStatus = {
    isOnline: typeof patch.isOnline === "boolean" ? patch.isOnline : current.isOnline,
    dineInActive: typeof patch.dineInActive === "boolean" ? patch.dineInActive : current.dineInActive,
    deliveryActive: typeof patch.deliveryActive === "boolean" ? patch.deliveryActive : current.deliveryActive,
    pickupActive: typeof patch.pickupActive === "boolean" ? patch.pickupActive : current.pickupActive,
    updatedAt: new Date().toISOString(),
  };

  await prisma.$executeRaw`
    INSERT INTO outlet_status (
      outlet_id, is_online, dine_in_active, delivery_active, pickup_active, updated_at, updated_by
    ) VALUES (
      ${outletId}::uuid,
      ${next.isOnline},
      ${next.dineInActive},
      ${next.deliveryActive},
      ${next.pickupActive},
      NOW(),
      ${userId}::uuid
    )
    ON CONFLICT (outlet_id) DO UPDATE SET
      is_online = EXCLUDED.is_online,
      dine_in_active = EXCLUDED.dine_in_active,
      delivery_active = EXCLUDED.delivery_active,
      pickup_active = EXCLUDED.pickup_active,
      updated_at = NOW(),
      updated_by = EXCLUDED.updated_by
  `;

  return loadOutletOpsStatus(outletId);
}

export function normalizeOpsOrderType(
  orderType: string | null | undefined,
): "DINE_IN" | "DELIVERY" | "PICKUP" {
  if (orderType === "DELIVERY" || orderType === "AGGREGATOR") return "DELIVERY";
  if (orderType === "PICKUP" || orderType === "TAKEAWAY") return "PICKUP";
  return "DINE_IN";
}

export function channelPausedReason(
  status: OutletOpsStatus,
  orderType: "DINE_IN" | "DELIVERY" | "PICKUP",
): string | null {
  if (!status.isOnline) return "Store is paused; new orders are not accepted";
  if (orderType === "DINE_IN" && !status.dineInActive) return "Dine-in is paused";
  if (orderType === "DELIVERY" && !status.deliveryActive) return "Delivery is paused";
  if (orderType === "PICKUP" && !status.pickupActive) return "Pickup is paused";
  return null;
}
