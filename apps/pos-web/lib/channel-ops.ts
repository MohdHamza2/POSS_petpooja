export type OutletOpsStatus = {
  isOnline: boolean;
  dineInActive: boolean;
  deliveryActive: boolean;
  pickupActive: boolean;
};

export function opsStatusFromPayload(
  data: Record<string, unknown> | undefined | null,
): OutletOpsStatus {
  return {
    isOnline: data?.isOnline !== false,
    dineInActive: data?.dineInActive !== false,
    deliveryActive: data?.deliveryActive !== false,
    pickupActive: data?.pickupActive !== false,
  };
}

export function channelPausedMessage(
  status: OutletOpsStatus | null,
  orderType: "DINE_IN" | "DELIVERY" | "PICKUP",
): string | null {
  if (!status) return null;
  if (!status.isOnline) return "Store is paused; new orders are not accepted";
  if (orderType === "DINE_IN" && !status.dineInActive) return "Dine-in is paused";
  if (orderType === "DELIVERY" && !status.deliveryActive) return "Delivery is paused";
  if (orderType === "PICKUP" && !status.pickupActive) return "Pickup is paused";
  return null;
}
