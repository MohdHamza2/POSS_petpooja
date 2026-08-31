import { describe, it, expect, vi } from "vitest";
import { RbacSecurityGuard } from "./rbac-security-guard";

describe("RBAC Security & Negative Authorization Suite", () => {
  it("strictly denies Cashier from executing manager order.void", async () => {
    const mockPrisma = {
      userRole: {
        findFirst: async () => ({ userId: "u-cashier", outletId: "outlet-1", roleId: "role-cashier" }),
        findMany: async () => [{ userId: "u-cashier", outletId: "outlet-1", roleId: "role-cashier" }],
      },
      role: {
        findMany: async () => [{ id: "role-cashier", name: "CASHIER", code: "CASHIER" }],
      },
      rolePermission: {
        findMany: async () => [
          { roleId: "role-cashier", permissionId: "perm-order.create" },
          { roleId: "role-cashier", permissionId: "perm-order.read" },
          { roleId: "role-cashier", permissionId: "perm-payment.capture" },
        ],
      },
      permission: {
        findMany: async () => [
          { id: "perm-order.create", action: "order.create", code: "order.create" },
          { id: "perm-order.read", action: "order.read", code: "order.read" },
          { id: "perm-payment.capture", action: "payment.capture", code: "payment.capture" },
        ],
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: "audit-1" }),
      },
    } as any;

    const guard = new RbacSecurityGuard(mockPrisma);
    const auth = await guard.authorize("u-cashier", "outlet-1", "order.void");

    expect(auth.authorized).toBe(false);
    expect(auth.reason).toContain("no role at this outlet grants 'order.void'");
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("strictly denies Kitchen user from executing payment.capture", async () => {
    const mockPrisma = {
      userRole: {
        findFirst: async () => ({ userId: "u-chef", outletId: "outlet-1", roleId: "role-kitchen" }),
        findMany: async () => [{ userId: "u-chef", outletId: "outlet-1", roleId: "role-kitchen" }],
      },
      role: {
        findMany: async () => [{ id: "role-kitchen", name: "KITCHEN_USER", code: "KITCHEN_USER" }],
      },
      rolePermission: {
        findMany: async () => [
          { roleId: "role-kitchen", permissionId: "perm-kot.read" },
          { roleId: "role-kitchen", permissionId: "perm-kot.status.update" },
        ],
      },
      permission: {
        findMany: async () => [
          { id: "perm-kot.read", action: "kot.read", code: "kot.read" },
          { id: "perm-kot.status.update", action: "kot.status.update", code: "kot.status.update" },
        ],
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: "audit-2" }),
      },
    } as any;

    const guard = new RbacSecurityGuard(mockPrisma);
    const auth = await guard.authorize("u-chef", "outlet-1", "payment.capture");

    expect(auth.authorized).toBe(false);
    expect(mockPrisma.auditLog.create).toHaveBeenCalled();
  });

  it("blocks cross-tenant access and logs security incident when user accesses foreign outlet", async () => {
    const mockPrisma = {
      userRole: {
        // User has role only at outlet-1, not outlet-foreign
        findFirst: async () => null,
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: "audit-breach" }),
      },
    } as any;

    const guard = new RbacSecurityGuard(mockPrisma);
    const auth = await guard.authorize("u-user1", "outlet-foreign", "order.read");

    expect(auth.authorized).toBe(false);
    expect(auth.reason).toBe("TENANT_OUTLET_BOUNDARY_VIOLATION");
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "OVERRIDE",
          entityId: "outlet-foreign",
          afterState: expect.objectContaining({
            originalAction: "SECURITY_VIOLATION_TENANT_BREACH",
          }),
        }),
      })
    );
  });

  it("permits Super Admin with org-wide grant (outletId: null) across any outlet", async () => {
    const mockPrisma = {
      userRole: {
        findFirst: async () => ({ userId: "u-admin", outletId: null, roleId: "role-admin" }),
        findMany: async () => [{ userId: "u-admin", outletId: null, roleId: "role-admin" }],
      },
      role: {
        findMany: async () => [{ id: "role-admin", name: "SUPER_ADMIN", code: "SUPER_ADMIN" }],
      },
      rolePermission: {
        findMany: async () => [{ roleId: "role-admin", permissionId: "perm-order.void" }],
      },
      permission: {
        findMany: async () => [
          { id: "perm-order.create", action: "order.create", code: "order.create" },
          { id: "perm-order.void", action: "order.void", code: "order.void" },
          { id: "perm-payment.refund", action: "payment.refund", code: "payment.refund" },
        ],
      },
      auditLog: {
        create: vi.fn(),
      },
    } as any;

    const guard = new RbacSecurityGuard(mockPrisma);
    const auth = await guard.authorize("u-admin", "any-outlet-id", "order.void");

    expect(auth.authorized).toBe(true);
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });
});
