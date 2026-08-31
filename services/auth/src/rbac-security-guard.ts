import { PrismaClient } from "@prisma/client";
import { writeAuditLog } from "@kapmeta/shared-types/audit-log";
import { PrismaRbacChecker } from "./rbac";

export interface SecurityViolation {
  userId: string;
  attemptedOutletId: string;
  action: string;
  timestamp: string;
  reason: string;
}

export class RbacSecurityGuard {
  private rbac: PrismaRbacChecker;

  constructor(private readonly prisma: PrismaClient) {
    this.rbac = new PrismaRbacChecker(prisma);
  }

  /**
   * Enforces multi-tenant boundary isolation.
   * If a user attempts to access an outlet they are not assigned to, logs an immutable audit security violation.
   */
  async enforceOutletBoundary(userId: string, targetOutletId: string): Promise<boolean> {
    const userRole = await this.prisma.userRole.findFirst({
      where: {
        userId,
        OR: [{ outletId: targetOutletId }, { outletId: null }],
      },
    });

    if (!userRole) {
      await writeAuditLog(this.prisma, {
        outletId: targetOutletId,
        userId,
        action: "OVERRIDE",
        entityType: "OUTLET",
        entityId: targetOutletId,
        reasonCode: "CROSS_OUTLET_UNAUTHORIZED_ACCESS_ATTEMPT",
        afterState: {
          originalAction: "SECURITY_VIOLATION_TENANT_BREACH",
          reason: "CROSS_OUTLET_UNAUTHORIZED_ACCESS_ATTEMPT",
          attemptedAt: new Date().toISOString(),
        },
      });
      return false;
    }

    return true;
  }

  /**
   * Evaluates if a subject has the strict permission to execute a privileged mutation.
   */
  async authorize(userId: string, outletId: string, action: string): Promise<{ authorized: boolean; reason?: string }> {
    const boundaryOk = await this.enforceOutletBoundary(userId, outletId);
    if (!boundaryOk) {
      return { authorized: false, reason: "TENANT_OUTLET_BOUNDARY_VIOLATION" };
    }

    const check = await this.rbac.checkPermission({ userId, outletId, action });
    if (!check.allowed) {
      await writeAuditLog(this.prisma, {
        outletId,
        userId,
        action: "OVERRIDE",
        entityType: "USER",
        entityId: userId,
        reasonCode: check.reason || "UNAUTHORIZED_ACTION",
        afterState: {
          originalAction: "SECURITY_VIOLATION_UNAUTHORIZED_ACTION",
          attemptedAction: action,
          reason: check.reason,
          timestamp: new Date().toISOString(),
        },
      });
      return { authorized: false, reason: check.reason };
    }

    return { authorized: true };
  }
}
