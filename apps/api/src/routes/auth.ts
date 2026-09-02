import { Router } from "express";
import { prisma } from "../prisma";
import {
  signAccessToken,
  generateRefreshToken,
  PrismaSessionStore,
  PrismaUserRepository,
  PrismaRbacChecker,
  verifyPassword,
} from "@kapmeta/auth";
import type { LoginFailure } from "@kapmeta/shared-types/auth";
import { requireAuth, type AuthedRequest } from "../middleware/require-auth";

const rbac = new PrismaRbacChecker(prisma);

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET not set");
}

const ACCESS_TOKEN_TTL_SECONDS = 900;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const FAILURE_STATUS: Record<LoginFailure["reason"], number> = {
  INVALID_CREDENTIALS: 401,
  USER_INACTIVE: 403,
  NO_OUTLET_ACCESS: 403,
};

const router = Router();

const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MS = 15 * 60 * 1000;
const pinFailures = new Map<string, { count: number; lockedUntil: number }>();

function pinAttemptKey(req: { ip?: string; socket?: { remoteAddress?: string } }, userId: string): string {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  return `${ip}:${userId}`;
}

function pinLockRemainingMs(key: string): number {
  const row = pinFailures.get(key);
  if (!row) return 0;
  return Math.max(0, row.lockedUntil - Date.now());
}

router.post("/login", async (req, res) => {
  try {
    const { email, password, outletId } = req.body;

    const userRepository = new PrismaUserRepository(prisma);
    const result = await userRepository.verifyCredentials({ email, password }, outletId);

    if ("failure" in result) {
      res.status(FAILURE_STATUS[result.failure]).json({ error: result.failure });
      return;
    }

    const { user } = result;
    const sessionStore = new PrismaSessionStore(prisma);
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    const session = await sessionStore.create(user.userId, outletId, refreshToken, expiresAt);

    const accessToken = signAccessToken(
      { sub: user.userId, outletIds: [outletId], sessionId: session.id },
      JWT_SECRET,
      ACCESS_TOKEN_TTL_SECONDS
    );

    res.status(200).json({
      accessToken,
      refreshToken,
      expiresAt,
      user: { userId: user.userId, email: user.email, outletId },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

// Fast PIN-based login for floor staff / waiters / captains on tablets
router.post("/pin-login", async (req, res) => {
  try {
    const { pin, userId, email, outletId } = req.body as {
      pin?: string;
      userId?: string;
      email?: string;
      outletId?: string;
    };

    if (!pin || typeof pin !== "string") {
      res.status(400).json({ error: "PIN is required" });
      return;
    }

    if (!outletId) {
      res.status(400).json({ error: "outletId is required" });
      return;
    }

    const attemptKey = pinAttemptKey(req, userId || email || "unknown");
    const lockMs = pinLockRemainingMs(attemptKey);
    if (lockMs > 0) {
      res.status(429).json({ error: "PIN_LOCKED", retryAfterMs: lockMs });
      return;
    }

    let user = null;
    if (userId) {
      user = await prisma.user.findUnique({ where: { id: userId } });
    } else if (email) {
      user = await prisma.user.findUnique({ where: { email } });
    }

    if (!user) {
      const fail = pinFailures.get(attemptKey) || { count: 0, lockedUntil: 0 };
      fail.count += 1;
      if (fail.count >= PIN_MAX_FAILURES) fail.lockedUntil = Date.now() + PIN_LOCK_MS;
      pinFailures.set(attemptKey, fail);
      res.status(401).json({ error: "INVALID_CREDENTIALS" });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({ error: "USER_INACTIVE" });
      return;
    }

    if (!user.pinHash) {
      res.status(401).json({ error: "NO_PIN_CONFIGURED" });
      return;
    }

    const isValidPin = await verifyPassword(pin, user.pinHash);
    if (!isValidPin) {
      const fail = pinFailures.get(attemptKey) || { count: 0, lockedUntil: 0 };
      fail.count += 1;
      if (fail.count >= PIN_MAX_FAILURES) fail.lockedUntil = Date.now() + PIN_LOCK_MS;
      pinFailures.set(attemptKey, fail);
      res.status(401).json({ error: "INVALID_CREDENTIALS" });
      return;
    }
    pinFailures.delete(attemptKey);

    // Verify outlet access
    const grant = await prisma.userRole.findFirst({
      where: {
        userId: user.id,
        OR: [{ outletId }, { outletId: null }],
      },
    });

    if (!grant) {
      res.status(403).json({ error: "NO_OUTLET_ACCESS" });
      return;
    }

    const sessionStore = new PrismaSessionStore(prisma);
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    const session = await sessionStore.create(user.id, outletId, refreshToken, expiresAt);

    const accessToken = signAccessToken(
      { sub: user.id, outletIds: [outletId], sessionId: session.id },
      JWT_SECRET,
      ACCESS_TOKEN_TTL_SECONDS
    );

    res.status(200).json({
      accessToken,
      refreshToken,
      expiresAt,
      user: {
        userId: user.id,
        name: `${user.firstName} ${user.lastName}`.trim(),
        email: user.email,
        outletId,
      },
    });
    // #region agent log
    fetch("http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "9c675b" },
      body: JSON.stringify({
        sessionId: "9c675b",
        hypothesisId: "PIN-B",
        location: "auth.ts:POST /pin-login",
        message: "pin login issued tokens",
        data: { userId: user.id, outletId, hasRefresh: Boolean(refreshToken) },
        timestamp: Date.now(),
        runId: "pin-staff",
      }),
    }).catch(err => console.error('Background task error:', err?.message || err));
    // #endregion
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;

    const sessionStore = new PrismaSessionStore(prisma);
    const session = await sessionStore.findByToken(refreshToken);

    if (!session) {
      res.status(401).json({ error: "invalid or expired refresh token" });
      return;
    }

    // TODO: rotate refresh token on each use (out of scope for this scaffold).
    const accessToken = signAccessToken(
      { sub: session.userId, outletIds: [session.outletId], sessionId: session.id },
      JWT_SECRET,
      ACCESS_TOKEN_TTL_SECONDS
    );

    res.status(200).json({ accessToken, expiresAt: session.expiresAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.post("/logout", async (req, res) => {
  try {
    const { sessionId } = req.body;

    const sessionStore = new PrismaSessionStore(prisma);
    await sessionStore.revoke(sessionId);

    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

// GET /auth/outlets/mine — real outlets the current user has a UserRole grant
// for (per repo CLAUDE.md no-hardcode-data rule, this must be DB-driven, not
// a fixed list). A UserRole row with outletId === null is an org-wide grant
// (Super Admin) and gives access to every active outlet; otherwise the user
// is limited to the specific outlet(s) they have a row for.
router.get("/outlets/mine", requireAuth, async (req: AuthedRequest, res) => {
  try {
    if (!req.auth) {
      res.status(401).json({ error: "missing bearer token" });
      return;
    }

    const userRoles = await prisma.userRole.findMany({
      where: { userId: req.auth.userId },
      select: { outletId: true },
    });

    const hasOrgWideGrant = userRoles.some((ur) => ur.outletId === null);

    const outlets = hasOrgWideGrant
      ? await prisma.outlet.findMany({
          where: { isActive: true },
          orderBy: { name: "asc" },
        })
      : await prisma.outlet.findMany({
          where: {
            isActive: true,
            id: { in: [...new Set(userRoles.map((ur) => ur.outletId).filter((id): id is string => id !== null))] },
          },
          orderBy: { name: "asc" },
        });

    res.status(200).json(
      outlets.map((outlet) => ({
        id: outlet.id,
        name: outlet.name,
        code: outlet.code,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

// GET /auth/outlets — resolve one active outlet by code for the login picker.
router.get("/outlets", async (req, res) => {
  try {
    const code = typeof req.query.code === "string" ? req.query.code.trim() : "";
    if (!code) {
      // #region agent log
      fetch("http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "9c675b" },
        body: JSON.stringify({
          sessionId: "9c675b",
          hypothesisId: "S1",
          location: "auth.ts:GET /outlets",
          message: "public outlet directory rejected without code",
          data: { hasCode: false, count: 0 },
          timestamp: Date.now(),
          runId: "sec-auth",
        }),
      }).catch(err => console.error('Background task error:', err?.message || err));
      // #endregion
      res.status(400).json({ error: "outlet code is required" });
      return;
    }

    const outlets = await prisma.outlet.findMany({
      where: { isActive: true, code: { equals: code, mode: "insensitive" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    });
    // #region agent log
    fetch("http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "9c675b" },
      body: JSON.stringify({
        sessionId: "9c675b",
        hypothesisId: "S1",
        location: "auth.ts:GET /outlets",
        message: "public outlet lookup by code",
        data: { hasCode: true, count: outlets.length, codes: outlets.map((o) => o.code) },
        timestamp: Date.now(),
        runId: "sec-auth",
      }),
    }).catch(err => console.error('Background task error:', err?.message || err));
    // #endregion
    res.status(200).json(outlets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

// GET /auth/pin-staff — PIN-enabled staff for an outlet. Names/roles only.
router.get("/pin-staff", async (req, res) => {
  try {
    const outletId = typeof req.query.outletId === "string" ? req.query.outletId : "";
    if (!outletId) {
      res.status(400).json({ error: "outletId is required" });
      return;
    }

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        pinHash: { not: null },
        userRoles: {
          some: {
            OR: [{ outletId }, { outletId: null }],
          },
        },
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        userRoles: {
          where: { OR: [{ outletId }, { outletId: null }] },
          include: { role: true },
        },
      },
    });

    const staff = users.map((user) => ({
      id: user.id,
      name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Staff",
      role: user.userRoles[0]?.role?.name ?? "Staff",
    }));

    // #region agent log
    fetch("http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "9c675b" },
      body: JSON.stringify({
        sessionId: "9c675b",
        hypothesisId: "S2",
        location: "auth.ts:GET /pin-staff",
        message: "pin-enabled staff from DB",
        data: {
          outletId,
          count: staff.length,
          fields: staff[0] ? Object.keys(staff[0]) : [],
          hasEmail: staff.some((s) => "email" in s),
        },
        timestamp: Date.now(),
        runId: "pin-staff",
      }),
    }).catch(err => console.error('Background task error:', err?.message || err));
    // #endregion

    res.status(200).json(staff);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

// POST /auth/switch-outlet — re-issues an access token scoped to a different
// outlet the current user already holds a real UserRole grant for, without
// requiring the password again. Login already requires a password (see
// POST /login above), so re-authenticating on every outlet switch would be
// bad UX; this endpoint re-validates the grant server-side (never trusts the
// client's claim) and mints a fresh session the same way /login does.
router.post("/switch-outlet", requireAuth, async (req: AuthedRequest, res) => {
  try {
    if (!req.auth) {
      res.status(401).json({ error: "missing bearer token" });
      return;
    }

    const { outletId } = req.body as { outletId?: string };
    if (!outletId || typeof outletId !== "string") {
      res.status(400).json({ error: "outletId is required" });
      return;
    }

    const grant = await prisma.userRole.findFirst({
      where: {
        userId: req.auth.userId,
        OR: [{ outletId }, { outletId: null }],
      },
    });

    if (!grant) {
      res.status(403).json({ error: "NO_OUTLET_ACCESS" });
      return;
    }

    const outlet = await prisma.outlet.findUnique({ where: { id: outletId } });
    if (!outlet || !outlet.isActive) {
      res.status(404).json({ error: "outlet not found" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user || !user.isActive) {
      res.status(403).json({ error: "USER_INACTIVE" });
      return;
    }

    const sessionStore = new PrismaSessionStore(prisma);
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    const session = await sessionStore.create(user.id, outletId, refreshToken, expiresAt);

    const accessToken = signAccessToken(
      { sub: user.id, outletIds: [outletId], sessionId: session.id },
      JWT_SECRET,
      ACCESS_TOKEN_TTL_SECONDS
    );

    res.status(200).json({
      accessToken,
      refreshToken,
      expiresAt,
      user: { userId: user.id, email: user.email, outletId },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  try {
    if (!req.auth) {
      res.status(401).json({ error: "missing bearer token" });
      return;
    }

    const { userId, outletId } = req.auth;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ error: "user not found" });
      return;
    }

    const { roles, permissions } = await rbac.listPermissions(userId, outletId);

    // Real outlet identity fields for receipt/terminal display (name, address,
    // FSSAI, UPI VPA) plus the org-level GSTIN
    let outletData = null;
    const outlet = await prisma.outlet.findUnique({
      where: { id: outletId },
    });

    if (outlet) {
      const organization = await prisma.organization.findUnique({
        where: { id: outlet.organizationId },
      });
      outletData = {
        id: outlet.id,
        code: outlet.code,
        name: outlet.name,
        address: (outlet as any).address || null,
        fssaiNumber: (outlet as any).fssaiNumber || null,
        upiVpa: (outlet as any).upiVpa || null,
        taxNumber: (organization as any)?.taxNumber || (organization as any)?.tax_id || null,
        loyaltyPaisePerPoint: outlet.loyaltyPaisePerPoint != null ? outlet.loyaltyPaisePerPoint.toString() : null,
      };
    }

    res.status(200).json({
      userId: user.id,
      email: user.email,
      name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.full_name || 'Admin',
      outletId,
      roles,
      permissions,
      outlet: outletData,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

// Verifies the real 4-digit cashier PIN (User.pinHash) for the currently
// authenticated user before unlocking the POS terminal. No PIN value is ever
// accepted client-side — this is the only source of truth for the unlock.
router.post("/verify-pin", requireAuth, async (req: AuthedRequest, res) => {
  try {
    if (!req.auth) {
      res.status(401).json({ error: "missing bearer token" });
      return;
    }

    const { pin } = req.body as { pin?: string };
    if (!pin || typeof pin !== "string") {
      res.status(400).json({ error: "pin is required" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user || !user.pinHash) {
      res.status(401).json({ valid: false, error: "no PIN configured for this user" });
      return;
    }

    const valid = await verifyPassword(pin, user.pinHash);
    res.status(200).json({ valid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

export const authRouter = router;
