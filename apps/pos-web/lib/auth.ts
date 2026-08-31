// Shared client-side auth state for pos-web. No hardcoded users/roles/permissions
// anywhere here — everything comes from the real POST /auth/login and
// GET /auth/me responses (apps/api/src/routes/auth.ts).
import { useEffect, useState } from "react";

export function getApiBase(): string {
  if (typeof window !== "undefined") {
    if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
    return `${window.location.protocol}//${window.location.hostname}:4001`;
  }
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:4001";
}

export function getWsBase(): string {
  if (typeof window !== "undefined") {
    if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.hostname}:4001/ws`;
  }
  return process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:4001/ws";
}

export const API_BASE = "http://localhost:4001";
export const WS_BASE = "ws://localhost:4001/ws";
export const STORAGE_KEY = "kapmeta_pos_session";

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  userId: string;
  email: string;
  outletId: string;
  sessionId?: string;
}

export interface MeOutlet {
  id: string;
  code?: string | null;
  name: string;
  address: string | null;
  fssaiNumber: string | null;
  upiVpa: string | null;
  taxNumber: string | null;
  loyaltyPaisePerPoint?: string | null;
}

export interface MeResponse {
  userId: string;
  email: string;
  name: string;
  outletId: string;
  roles: string[];
  permissions: string[];
  outlet: MeOutlet | null;
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

// Decodes the (unsigned-here, already-trusted-because-we-just-received-it-over-TLS)
// JWT payload to recover the sessionId claim for logout — the login response
// itself doesn't echo session.id, and we must not invent one.
function decodeSessionIdFromToken(accessToken: string): string | undefined {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return undefined;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json);
    return typeof claims.sessionId === "string" ? claims.sessionId : undefined;
  } catch {
    return undefined;
  }
}

export function getSession(): { accessToken: string; userId: string; email: string; outletId: string } | null {
  if (!isBrowser()) return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const stored: StoredSession = JSON.parse(raw);
    if (!stored.accessToken) return null;
    return {
      accessToken: stored.accessToken,
      userId: stored.userId,
      email: stored.email,
      outletId: stored.outletId,
    };
  } catch {
    return null;
  }
}

function getStoredSessionFull(): StoredSession | null {
  if (!isBrowser()) return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export async function login(
  email: string,
  password: string,
  outletId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, outletId }),
    });

    if (!res.ok) {
      // Clear any stale session data on failed login to avoid stale token issues
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(STORAGE_KEY);
      }
      let error = "LOGIN_FAILED";
      try {
        const body = await res.json();
        if (typeof body.error === "string") error = body.error;
      } catch {
        // ignore parse failure, fall back to generic error
      }
      return { ok: false, error };
    }

    const data = await res.json();
    const stored: StoredSession = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt,
      userId: data.user.userId,
      email: data.user.email,
      outletId: data.user.outletId,
      sessionId: decodeSessionIdFromToken(data.accessToken),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "NETWORK_ERROR" };
  }
}

export async function logout(): Promise<void> {
  const stored = getStoredSessionFull();
  if (stored?.sessionId) {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: stored.sessionId }),
      });
    } catch {
      // best-effort — still clear local session below
    }
  }
  if (isBrowser()) {
    window.localStorage.removeItem(STORAGE_KEY);
    if (window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
  }
}

export interface OutletSummary {
  id: string;
  name: string;
  code: string;
}

// Real outlets the current user has a UserRole grant for (GET /auth/outlets/mine,
// apps/api/src/routes/auth.ts) — never a hardcoded list per repo CLAUDE.md.
export async function fetchMyOutlets(): Promise<OutletSummary[]> {
  const session = getSession();
  if (!session) return [];
  try {
    const res = await fetch(`${API_BASE}/auth/outlets/mine`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!res.ok) return [];
    return (await res.json()) as OutletSummary[];
  } catch {
    return [];
  }
}

// Switches the active outlet without re-prompting for a password: calls
// POST /auth/switch-outlet, which re-validates the caller's real UserRole
// grant server-side and mints a fresh token scoped to the new outlet.
export async function switchOutlet(outletId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = getSession();
  if (!session) return { ok: false, error: "NOT_LOGGED_IN" };
  try {
    const res = await fetch(`${API_BASE}/auth/switch-outlet`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({ outletId }),
    });

    if (!res.ok) {
      let error = "SWITCH_FAILED";
      try {
        const body = await res.json();
        if (typeof body.error === "string") error = body.error;
      } catch {
        // ignore parse failure, fall back to generic error
      }
      return { ok: false, error };
    }

    const data = await res.json();
    const stored: StoredSession = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt,
      userId: data.user.userId,
      email: data.user.email,
      outletId: data.user.outletId,
      sessionId: decodeSessionIdFromToken(data.accessToken),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "NETWORK_ERROR" };
  }
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (!isBrowser()) return false;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const full = getStoredSessionFull();
    if (!full?.refreshToken) return false;
    try {
      const res = await fetch(`${getApiBase()}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: full.refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (typeof data.accessToken !== "string") return false;
      const next: StoredSession = {
        ...full,
        accessToken: data.accessToken,
        expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : full.expiresAt,
        sessionId: decodeSessionIdFromToken(data.accessToken) ?? full.sessionId,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function fetchMe(): Promise<MeResponse | null> {
  const session = getSession();
  if (!session) return null;
  const base = getApiBase();
  const res = await fetch(`${base}/auth/me`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  if (res.status === 401) {
    if (await refreshAccessToken()) {
      const session2 = getSession();
      if (!session2) return null;
      const res2 = await fetch(`${base}/auth/me`, {
        headers: { Authorization: `Bearer ${session2.accessToken}` },
      });
      if (res2.status === 401) return null;
      if (!res2.ok) {
        throw new Error(`auth/me ${res2.status}`);
      }
      return (await res2.json()) as MeResponse;
    }
    return null;
  }
  if (!res.ok) {
    throw new Error(`auth/me ${res.status}`);
  }
  return (await res.json()) as MeResponse;
}

// Verifies a terminal-unlock PIN against the real User.pinHash server-side
// (POST /auth/verify-pin, apps/api/src/routes/auth.ts). There is no
// client-side accepted PIN value — every attempt round-trips to the API.
export async function verifyPin(pin: string): Promise<boolean> {
  const session = getSession();
  if (!session) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/verify-pin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({ pin }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.valid === true;
  } catch {
    return false;
  }
}

type AuthedFetchOptions = RequestInit & { _retriedAfterRefresh?: boolean };

export async function authedFetch(url: string, options: AuthedFetchOptions = {}): Promise<Response> {
  const { _retriedAfterRefresh, ...fetchOptions } = options;
  const session = getSession();
  const headers = new Headers(fetchOptions.headers);
  if (session) {
    headers.set("Authorization", `Bearer ${session.accessToken}`);
    if (session.outletId && !headers.has("X-Outlet-Id")) {
      headers.set("X-Outlet-Id", session.outletId);
    }
  }

  if (fetchOptions.body && typeof fetchOptions.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const base = getApiBase();
  const finalUrl = url.startsWith("http://") || url.startsWith("https://") ? url : `${base}${url.startsWith("/") ? "" : "/"}${url}`;
  let res: Response;
  try {
    res = await fetch(finalUrl, { ...fetchOptions, headers });
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'K1',location:'auth.ts:authedFetch',message:'network error without wiping session',data:{url:finalUrl,err:String(err)},timestamp:Date.now(),runId:'cover-0029'})}).catch(()=>{});
    // #endregion
    return new Response(JSON.stringify({ error: "NETWORK_ERROR" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (res.status === 401) {
    // #region agent log
    const errBody = await res.clone().text().catch(() => "");
    const full = getStoredSessionFull();
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'K2',location:'auth.ts:authedFetch',message:'401 received',data:{url:finalUrl,method:fetchOptions.method||'GET',hasSession:!!session,tokenLen:session?.accessToken?.length||0,expiresAt:full?.expiresAt||null,retried:Boolean(_retriedAfterRefresh),body:errBody.slice(0,240)},timestamp:Date.now(),runId:'cover-0029'})}).catch(()=>{});
    // #endregion
    if (!_retriedAfterRefresh && isBrowser() && full?.refreshToken) {
      const refreshed = await refreshAccessToken();
      // #region agent log
      fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'K6',location:'auth.ts:authedFetch',message:'refresh after 401',data:{url:finalUrl,refreshed},timestamp:Date.now(),runId:'cover-0029'})}).catch(()=>{});
      // #endregion
      if (refreshed) {
        return authedFetch(url, { ...fetchOptions, _retriedAfterRefresh: true });
      }
    }
    if (isBrowser()) {
      window.localStorage.removeItem(STORAGE_KEY);
      window.location.href = "/login";
    }
  }

  return res;
}

export function useAuthGuard(requiredPermission?: string): { me: MeResponse | null; loading: boolean } {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const session = getSession();
    if (!session) {
      window.location.href = "/login";
      return;
    }

    fetchMe().then((result) => {
      if (cancelled) return;
      if (!result) {
        // #region agent log
        fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'K1',location:'auth.ts:useAuthGuard',message:'auth/me 401 wiping session',data:{requiredPermission:requiredPermission||null},timestamp:Date.now(),runId:'cover-0029'})}).catch(()=>{});
        // #endregion
        window.localStorage.removeItem(STORAGE_KEY);
        window.location.href = "/login";
        return;
      }
      if (requiredPermission && !result.permissions.includes(requiredPermission)) {
        if (result.permissions.includes("kot.read")) {
          window.location.href = "/kitchen";
          return;
        }
        if (result.permissions.includes("inventory.stock.adjust")) {
          window.location.href = "/inventory";
          return;
        }
        if (result.permissions.includes("menu.category.manage")) {
          window.location.href = "/admin";
          return;
        }
        setMe(result);
        setLoading(false);
        return;
      }
      setMe(result);
      setLoading(false);
    }).catch((err) => {
      // #region agent log
      fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'K1',location:'auth.ts:useAuthGuard',message:'auth/me failed without wiping session',data:{err:String(err),requiredPermission:requiredPermission||null},timestamp:Date.now(),runId:'cover-0029'})}).catch(()=>{});
      // #endregion
      if (cancelled) return;
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requiredPermission]);

  return { me, loading };
}
