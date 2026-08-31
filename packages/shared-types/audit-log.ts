export type AuditEntityType =
  | "ORDER"
  | "PAYMENT"
  | "MENU_ITEM"
  | "STOCK"
  | "KOT"
  | "PURCHASE_ORDER"
  | "REFUND"
  | "USER"
  | "DINING_TABLE"
  | "OUTLET";

export interface AuditLogInput {
  outletId: string;
  userId: string;
  approverUserId?: string;
  action: string;
  entityType: AuditEntityType;
  entityId: string;
  beforeState?: unknown;
  afterState?: unknown;
  reasonCode?: string;
  ipAddress?: string;
}

/** Minimal shape any Prisma client (or tx) exposes for audit writes — avoids a hard @prisma/client dependency in shared-types. */
export interface AuditLogWriter {
  auditLog: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

function mapToPrismaAction(action: string): "CREATE" | "UPDATE" | "DELETE" | "APPROVE" | "OVERRIDE" | "EXPORT" {
  const upper = action.toUpperCase();
  if (upper.includes("OVERRIDE") || upper.includes("VOID")) return "OVERRIDE";
  if (upper.includes("APPROVE") || upper.includes("CONFIRM")) return "APPROVE";
  if (upper.includes("DELETE") || upper.includes("CANCEL")) return "DELETE";
  if (upper.includes("UPDATE") || upper.includes("TOGGLE") || upper.includes("STATUS")) return "UPDATE";
  if (upper.includes("EXPORT")) return "EXPORT";
  return "CREATE";
}

/**
 * Writes one immutable audit_logs row. Call inside the same transaction as the
 * privileged mutation it records (void, discount, refund, override, 86-toggle, etc).
 */
export async function writeAuditLog(client: AuditLogWriter, input: AuditLogInput): Promise<void> {
  const actionEnum = mapToPrismaAction(input.action);
  const afterStateObj = {
    originalAction: input.action,
    reasonCode: input.reasonCode,
    approverUserId: input.approverUserId,
    ipAddress: input.ipAddress,
    ...(typeof input.afterState === "object" && input.afterState !== null ? (input.afterState as object) : input.afterState !== undefined ? { value: input.afterState } : {}),
  };

  await client.auditLog.create({
    data: {
      outletId: input.outletId,
      actor_id: input.userId,
      action: actionEnum,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeState: (input.beforeState as any) ?? undefined,
      afterState: afterStateObj,
    },
  });
}
