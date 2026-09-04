import { Router } from "express";
import bcrypt from "bcryptjs";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/require-auth";
import { prisma } from "../prisma";

const router = Router();

// Gated on "users.manage" which is now seeded in seed_permissions.sql.
const USER_MANAGEMENT_PERMISSION = "users.manage";

// GET /users — list users with their current role assignments (+ outlet).
router.get(
  "/users",
  requireAuth,
  requirePermission(USER_MANAGEMENT_PERMISSION),
  async (req: AuthedRequest, res) => {
    try {
      const outletId = req.auth!.outletId;
      const users = await prisma.user.findMany({
        where: {
          userRoles: {
            some: {
              OR: [{ outletId }, { outletId: null }],
            },
          },
        },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        include: {
          userRoles: {
            include: {
              role: true,
              outlet: true,
            },
          },
        },
      });

      res.status(200).json(
        users.map((user) => ({
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
          isActive: user.isActive,
          hasPin: Boolean(user.pinHash),
          userRoles: user.userRoles.map((ur) => ({
            roleId: ur.roleId,
            roleName: ur.role.name,
            outletId: ur.outletId,
            outletName: ur.outlet?.name ?? null,
          })),
        }))
      );
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal error" });
    }
  }
);

// GET /roles — list all Role rows available to assign.
router.get(
  "/roles",
  requireAuth,
  requirePermission(USER_MANAGEMENT_PERMISSION),
  async (_req: AuthedRequest, res) => {
    try {
      const roles = await prisma.role.findMany({
        orderBy: { name: "asc" },
      });
      res.status(200).json(
        roles.map((role) => ({
          id: role.id,
          name: role.name,
          description: role.description,
        }))
      );
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal error" });
    }
  }
);

// GET /permissions — list all Permission rows available to grant.
router.get(
  "/permissions",
  requireAuth,
  requirePermission(USER_MANAGEMENT_PERMISSION),
  async (_req: AuthedRequest, res) => {
    try {
      const permissions = await prisma.permission.findMany({
        orderBy: { code: "asc" },
      });
      res.status(200).json(
        permissions.map((p) => ({
          id: p.id,
          action: (p as any).code || (p as any).action,
          description: p.description,
        }))
      );
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal error" });
    }
  }
);

// POST /roles — create a new role. body: { name, description }
router.post(
  "/roles",
  requireAuth,
  requirePermission(USER_MANAGEMENT_PERMISSION),
  async (req: AuthedRequest, res) => {
    try {
      const { name, description } = req.body as { name?: string; description?: string | null };
      if (!name || !name.trim()) {
        res.status(400).json({ error: "name is required" });
        return;
      }

      const existing = await prisma.role.findFirst({ where: { name: name.trim() } });
      if (existing) {
        res.status(400).json({ error: "role name already in use" });
        return;
      }

      const role = await prisma.role.create({
        data: {
          name: name.trim(),
          code: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"),
          description: description ?? null,
        },
      });

      res.status(201).json({ id: role.id, name: role.name, description: role.description });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal error" });
    }
  }
);

// PATCH /roles/:id — rename or redescribe a role.
router.patch(
  "/roles/:id",
  requireAuth,
  requirePermission(USER_MANAGEMENT_PERMISSION),
  async (req: AuthedRequest, res) => {
    try {
      const { id } = req.params;
      const { name, description } = req.body as { name?: string; description?: string | null };

      const role = await prisma.role.findUnique({ where: { id } });
      if (!role) {
        res.status(404).json({ error: "role not found" });
        return;
      }

      const updateData: { name?: string; description?: string | null; updatedBy: string } = {
        updatedBy: req.auth!.userId,
      };
      if (name && name.trim()) {
        const clash = await prisma.role.findFirst({ where: { name: name.trim(), NOT: { id } } });
        if (clash) {
          res.status(400).json({ error: "role name already in use" });
          return;
        }
        updateData.name = name.trim();
      }
      if (description !== undefined) updateData.description = description;

      const updated = await prisma.role.update({ where: { id }, data: updateData });
      res.status(200).json({ id: updated.id, name: updated.name, description: updated.description });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal error" });
    }
  }
);

// DELETE /roles/:id — remove a custom role (blocked if still assigned to users).
router.delete(
  "/roles/:id",
  requireAuth,
  requirePermission(USER_MANAGEMENT_PERMISSION),
  async (req: AuthedRequest, res) => {
    try {
      const { id } = req.params;
      const role = await prisma.role.findUnique({ where: { id } });
      if (!role) {
        res.status(404).json({ error: "role not found" });
        return;
      }

      const assignedCount = await prisma.userRole.count({ where: { roleId: id } });
      if (assignedCount > 0) {
        res.status(400).json({ error: `role still assigned to ${assignedCount} user(s) — revoke first` });
        return;
      }

      await prisma.role.delete({ where: { id } });
      res.status(204).send();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal error" });
    }
  }
);

// GET /roles/:id/permissions — which Permission actions a role currently grants.
router.get(
  "/roles/:id/permissions",
  requireAuth,
  requirePermission(USER_MANAGEMENT_PERMISSION),
  async (req: AuthedRequest, res) => {
    try {
      const { id } = req.params;
      const role = await prisma.role.findUnique({ where: { id } });
      if (!role) {
        res.status(404).json({ error: "role not found" });
        return;
      }

      const rolePermissions = await prisma.rolePermission.findMany({
        where: { roleId: id },
        select: { permissionId: true },
      });

      res.status(200).json({ permissionIds: rolePermissions.map((rp) => rp.permissionId) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal error" });
    }
  }
);

// PUT /roles/:id/permissions — replace a role's full permission set.
// body: { permissionIds: string[] }
router.put(
  "/roles/:id/permissions",
  requireAuth,
  requirePermission(USER_MANAGEMENT_PERMISSION),
  async (req: AuthedRequest, res) => {
    try {
      const { id } = req.params;
      const { permissionIds } = req.body as { permissionIds?: string[] };

      const role = await prisma.role.findUnique({ where: { id } });
      if (!role) {
        res.status(404).json({ error: "role not found" });
        return;
      }
      if (!Array.isArray(permissionIds)) {
        res.status(400).json({ error: "permissionIds must be an array" });
        return;
      }

      const validPermissions = await prisma.permission.findMany({
        where: { id: { in: permissionIds } },
        select: { id: true },
      });
      const validIds = new Set(validPermissions.map((p) => p.id));

      await prisma.$transaction([
        prisma.rolePermission.deleteMany({ where: { roleId: id } }),
        prisma.rolePermission.createMany({
          data: [...validIds].map((permissionId) => ({ roleId: id, permissionId })),
        }),
      ]);

      res.status(200).json({ permissionIds: [...validIds] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal error" });
    }
  }
);

// POST /users/:userId/roles — assign a role to a user (create UserRole row).
// body: { roleId: string, outletId: string | null }
router.post(
  "/users/:userId/roles",
  requireAuth,
  requirePermission(USER_MANAGEMENT_PERMISSION),
  async (req: AuthedRequest, res) => {
    try {
      const { userId } = req.params;
      const { roleId, outletId } = req.body as { roleId?: string; outletId?: string | null };

      if (!roleId) {
        res.status(400).json({ error: "roleId is required" });
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(404).json({ error: "user not found" });
        return;
      }

      const role = await prisma.role.findUnique({ where: { id: roleId } });
      if (!role) {
        res.status(404).json({ error: "role not found" });
        return;
      }

      if (outletId) {
        const outlet = await prisma.outlet.findUnique({ where: { id: outletId } });
        if (!outlet) {
          res.status(404).json({ error: "outlet not found" });
          return;
        }
      }

      const existingUserRole = await prisma.userRole.findFirst({
        where: { userId, roleId },
      });

      let userRole: any;
      if (existingUserRole) {
        userRole = await prisma.userRole.update({
          where: { id: existingUserRole.id },
          data: { outletId: outletId ?? null },
          include: { role: true, outlet: true },
        });
      } else {
        userRole = await prisma.userRole.create({
          data: {
            userId,
            roleId,
            outletId: outletId ?? null,
            granted_by: req.auth!.userId,
          },
          include: { role: true, outlet: true },
        });
      }

      res.status(201).json({
        roleId: userRole.roleId,
        roleName: userRole.role?.name || "Role",
        outletId: userRole.outletId,
        outletName: userRole.outlet?.name ?? null,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal error" });
    }
  }
);

// DELETE /users/:userId/roles/:userRoleId — revoke a role assignment.
router.delete(
  "/users/:userId/roles/:userRoleId",
  requireAuth,
  requirePermission(USER_MANAGEMENT_PERMISSION),
  async (req: AuthedRequest, res) => {
    try {
      const { userId, userRoleId } = req.params;

      const existing = await prisma.userRole.findFirst({
        where: { userId, OR: [{ id: userRoleId }, { roleId: userRoleId }] },
      });
      if (!existing) {
        res.status(404).json({ error: "role assignment not found" });
        return;
      }

      await prisma.userRole.delete({
        where: { id: existing.id },
      });

      res.status(204).send();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal error" });
    }
  }
);

// GET /quick-links — current user's own quick-link shortcuts, ordered by sortOrder.
router.get("/quick-links", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const quickLinks = await prisma.userQuickLink.findMany({
      where: { userId: req.auth!.userId },
      orderBy: { sortOrder: "asc" },
    });
    res.status(200).json(
      quickLinks.map((ql) => ({
        id: ql.id,
        label: ql.label,
        href: ql.href,
        sortOrder: ql.sortOrder,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

// POST /quick-links — add a shortcut for the current user. body: { label, href }
router.post("/quick-links", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const { label, href } = req.body as { label?: string; href?: string };

    if (!label || !href) {
      res.status(400).json({ error: "label and href are required" });
      return;
    }

    const maxSort = await prisma.userQuickLink.aggregate({
      where: { userId: req.auth!.userId },
      _max: { sortOrder: true },
    });

    const quickLink = await prisma.userQuickLink.create({
      data: {
        userId: req.auth!.userId,
        label,
        href,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
    });

    res.status(201).json({
      id: quickLink.id,
      label: quickLink.label,
      href: quickLink.href,
      sortOrder: quickLink.sortOrder,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

// DELETE /quick-links/:id — remove one of the current user's own shortcuts.
router.delete("/quick-links/:id", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const { id } = req.params;

    const existing = await prisma.userQuickLink.findUnique({ where: { id } });
    if (!existing || existing.userId !== req.auth!.userId) {
      res.status(404).json({ error: "quick link not found" });
      return;
    }

    await prisma.userQuickLink.delete({ where: { id } });

    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

// POST /users — Create a new staff/user account.
router.post(
  "/users",
  requireAuth,
  requirePermission(USER_MANAGEMENT_PERMISSION),
  async (req: AuthedRequest, res) => {
    try {
      const { email, password, pin, firstName, lastName, phone, isActive, roleId, outletId } = req.body;

      if (!email || !password || !firstName || !lastName) {
        res.status(400).json({ error: "email, password, firstName, and lastName are required" });
        return;
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        res.status(400).json({ error: "email already in use" });
        return;
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);
      const pinHash = pin ? await bcrypt.hash(pin, salt) : null;

      const newUser = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            pinHash,
            firstName,
            lastName,
            phone: phone ?? null,
            isActive: isActive !== false,
            createdBy: req.auth!.userId,
          },
        });

        if (roleId) {
          await tx.userRole.create({
            data: {
              userId: user.id,
              roleId,
              outletId: outletId ?? null,
              granted_by: req.auth!.userId,
            },
          });
        }

        return user;
      });

      res.status(201).json({
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        isActive: newUser.isActive,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal error" });
    }
  }
);

// PATCH /users/:id — Modify user account details or reset credentials.
router.patch(
  "/users/:id",
  requireAuth,
  requirePermission(USER_MANAGEMENT_PERMISSION),
  async (req: AuthedRequest, res) => {
    try {
      const { id } = req.params;
      const { email, password, pin, firstName, lastName, phone, isActive } = req.body;

      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) {
        res.status(404).json({ error: "user not found" });
        return;
      }

      const updateData: any = {};
      if (email) {
        const existing = await prisma.user.findFirst({
          where: { email, NOT: { id } },
        });
        if (existing) {
          res.status(400).json({ error: "email already in use" });
          return;
        }
        updateData.email = email;
      }

      if (password) {
        const salt = await bcrypt.genSalt(10);
        updateData.passwordHash = await bcrypt.hash(password, salt);
      }

      if (pin !== undefined) {
        if (pin) {
          const salt = await bcrypt.genSalt(10);
          updateData.pinHash = await bcrypt.hash(pin, salt);
        } else {
          updateData.pinHash = null;
        }
      }

      if (firstName) updateData.firstName = firstName;
      if (lastName) updateData.lastName = lastName;
      if (phone !== undefined) updateData.phone = phone ?? null;
      if (isActive !== undefined) updateData.isActive = isActive;
      updateData.updatedBy = req.auth!.userId;

      const updatedUser = await prisma.user.update({
        where: { id },
        data: updateData,
      });

      res.status(200).json({
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        isActive: updatedUser.isActive,
        hasPin: Boolean(updatedUser.pinHash),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal error" });
    }
  }
);

// DELETE /users/:id — Secure user account deletion.
router.delete(
  "/users/:id",
  requireAuth,
  requirePermission(USER_MANAGEMENT_PERMISSION),
  async (req: AuthedRequest, res) => {
    try {
      const { id } = req.params;

      if (id === req.auth!.userId) {
        res.status(400).json({ error: "cannot delete your own account" });
        return;
      }

      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) {
        res.status(404).json({ error: "user not found" });
        return;
      }

      await prisma.user.delete({ where: { id } });
      res.status(204).send();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal error" });
    }
  }
);

export const userManagementRouter = router;
