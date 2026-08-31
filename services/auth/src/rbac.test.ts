import { describe, it, expect } from "vitest";
import { PrismaRbacChecker } from "./rbac";

// Minimal fake mimicking the subset of PrismaClient that checkPermission /
// listPermissions actually touch: userRole.findMany with the
// role -> rolePermissions -> permission include shape. Follows the same
// hand-rolled-fake convention used in rbac-security.test.ts and
// prisma-inventory-repository.test.ts (no real DB, no Prisma mocking lib).
function makeFakePrisma(
  grants: Array<{ outletId: string | null; roleName: string; actions: string[] }>,
) {
  const roles: Array<{ id: string; name: string; code: string }> = [];
  const rolePerms: Array<{ roleId: string; permissionId: string }> = [];
  const perms: Array<{ id: string; action: string; code: string }> = [];
  const userRoles = grants.map((grant, i) => {
    const roleId = `role-${grant.roleName}-${i}`;
    roles.push({ id: roleId, name: grant.roleName, code: grant.roleName });
    for (const action of grant.actions) {
      const permissionId = `perm-${action}`;
      if (!perms.some((p) => p.id === permissionId)) {
        perms.push({ id: permissionId, action, code: action });
      }
      rolePerms.push({ roleId, permissionId });
    }
    return { userId: "u-1", outletId: grant.outletId, roleId };
  });

  return {
    userRole: {
      findMany: async () => userRoles,
    },
    role: {
      findMany: async ({ where }: { where?: { id?: { in: string[] } } }) =>
        roles.filter((r) => !where?.id?.in || where.id.in.includes(r.id)),
    },
    rolePermission: {
      findMany: async ({ where }: { where?: { roleId?: { in: string[] } } }) =>
        rolePerms.filter((rp) => !where?.roleId?.in || where.roleId.in.includes(rp.roleId)),
    },
    permission: {
      findMany: async (args?: { where?: { id?: { in: string[] } } }) => {
        if (!args?.where?.id?.in) return perms;
        return perms.filter((p) => args.where!.id!.in.includes(p.id));
      },
    },
  } as any;
}

describe("PrismaRbacChecker.checkPermission", () => {
  it("allows when an outlet-scoped grant includes the permission", async () => {
    const prisma = makeFakePrisma([
      { outletId: "outlet-1", roleName: "MANAGER", actions: ["order.void", "order.read"] },
    ]);
    const rbac = new PrismaRbacChecker(prisma);

    const result = await rbac.checkPermission({ userId: "u-1", outletId: "outlet-1", action: "order.void" });

    expect(result).toEqual({ allowed: true });
  });

  it("allows when an org-wide grant (outletId null) includes the permission", async () => {
    const prisma = makeFakePrisma([
      { outletId: null, roleName: "SUPER_ADMIN", actions: ["order.void", "payment.refund"] },
    ]);
    const rbac = new PrismaRbacChecker(prisma);

    const result = await rbac.checkPermission({ userId: "u-admin", outletId: "any-outlet", action: "payment.refund" });

    expect(result).toEqual({ allowed: true });
  });

  it("denies with a reason string when no matching role grants the action", async () => {
    const prisma = makeFakePrisma([
      { outletId: "outlet-1", roleName: "CASHIER", actions: ["order.create", "order.read"] },
    ]);
    const rbac = new PrismaRbacChecker(prisma);

    const result = await rbac.checkPermission({ userId: "u-cashier", outletId: "outlet-1", action: "order.void" });

    expect(result.allowed).toBe(false);
    expect((result as { reason: string }).reason).toBe("no role at this outlet grants 'order.void'");
  });

  it("denies when the user has no UserRole rows at all", async () => {
    const prisma = makeFakePrisma([]);
    const rbac = new PrismaRbacChecker(prisma);

    const result = await rbac.checkPermission({ userId: "u-none", outletId: "outlet-1", action: "order.read" });

    expect(result.allowed).toBe(false);
  });
});

describe("PrismaRbacChecker.listPermissions", () => {
  it("returns deduped role names and permission actions across multiple UserRole rows", async () => {
    const prisma = makeFakePrisma([
      { outletId: "outlet-1", roleName: "CASHIER", actions: ["order.create", "order.read"] },
      { outletId: null, roleName: "SUPER_ADMIN", actions: ["order.read", "payment.refund"] },
      { outletId: "outlet-1", roleName: "CASHIER", actions: ["order.create", "order.read"] },
    ]);
    const rbac = new PrismaRbacChecker(prisma);

    const result = await rbac.listPermissions("u-1", "outlet-1");

    expect(result.roles.sort()).toEqual(["CASHIER", "SUPER_ADMIN"]);
    expect(result.permissions.sort()).toEqual(["order.create", "order.read", "payment.refund"]);
  });

  it("returns empty roles/permissions when the user has no grants", async () => {
    const prisma = makeFakePrisma([]);
    const rbac = new PrismaRbacChecker(prisma);

    const result = await rbac.listPermissions("u-none", "outlet-1");

    expect(result).toEqual({ roles: [], permissions: [] });
  });
});
