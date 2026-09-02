import React, { useState, useEffect } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { login, fetchPublicOutlets, type OutletSummary } from "../lib/auth";
import CaptainPinLoginModal from "../components/CaptainPinLoginModal";

// Human-readable messages for LoginFailure["reason"] (packages/shared-types/auth.ts).
const ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: "Incorrect email or password. Please try again.",
  USER_INACTIVE: "This account has been deactivated. Contact your outlet admin.",
  NO_OUTLET_ACCESS: "This account has no access to the outlet you entered.",
  NETWORK_ERROR: "Cannot reach API server (port 4001). Make sure the backend is running.",
  LOGIN_FAILED: "Login failed. Please verify credentials and try again.",
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [outlets, setOutlets] = useState<OutletSummary[]>([]);
  const [outletCode, setOutletCode] = useState("");
  const [outletId, setOutletId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);

  useEffect(() => {
    const trimmed = outletCode.trim();
    if (trimmed.length < 2) {
      setOutlets([]);
      setOutletId("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetchPublicOutlets(trimmed).then((rows) => {
        if (cancelled) return;
        setOutlets(rows);
        setOutletId(rows[0]?.id || "");
        // #region agent log
        fetch("http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "9c675b" },
          body: JSON.stringify({
            sessionId: "9c675b",
            hypothesisId: "S1",
            location: "login.tsx:loadOutlets",
            message: "login outlets from code lookup",
            data: { count: rows.length, codes: rows.map((o) => o.code) },
            timestamp: Date.now(),
            runId: "sec-auth",
          }),
        }).catch(() => {});
        // #endregion
      });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [outletCode]);

  const performLogin = async (eMail: string, pass: string, outId: string, targetPath = "/") => {
    setError(null);
    setErrorDetail(null);
    setNotice(`Authenticating ${eMail}...`);
    setSubmitting(true);

    const result = await login(eMail, pass, outId);

    if (result.ok === false) {
      const friendlyMsg = ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.LOGIN_FAILED;
      setError(friendlyMsg);
      // Show raw error code for debugging if it doesn't match a known code
      if (!ERROR_MESSAGES[result.error]) {
        setErrorDetail(`Error code: ${result.error}`);
      }
      setNotice(null);
      setSubmitting(false);
      return;
    }

    setNotice("✓ Login successful! Redirecting to dashboard...");
    setTimeout(() => {
      window.location.href = targetPath;
    }, 400);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await performLogin(email, password, outletId, "/");
  };

  return (
    <div className="login-app">
      <Head>
        <title>Kapmeta POS — Sign In</title>
        <meta name="description" content="Sign in to the Kapmeta POS console." />
      </Head>

      <div className="login-card">
        {/* Brand Header */}
        <div className="brand-header">
          <h1 className="welcome-title">Welcome back!</h1>
          <p className="welcome-subtitle">Access your unified enterprise gateway dashboard.</p>
        </div>

        {/* Live Notification Bar */}
        {notice && (
          <div className="notification-banner success">
            <span className="notif-icon">✨</span>
            <span>{notice}</span>
          </div>
        )}

        {error && (
          <div className="notification-banner error">
            <span className="notif-icon">⚠️</span>
            <span>{error}{errorDetail ? ` (${errorDetail})` : ""}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="login-form">
          <div className="field-group">
            <label className="field-label" htmlFor="email">
              Username / Email
            </label>
            <div className="input-wrapper">
              <span className="input-icon">👤</span>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="field-input"
                placeholder="account@hotelkapila.com"
                autoComplete="username"
              />
            </div>
          </div>

          <div className="field-group">
            <div className="field-label-row">
              <label className="field-label" htmlFor="password">
                Password
              </label>
              <span className="forgot-password">Forgot Password?</span>
            </div>
            <div className="input-wrapper">
              <span className="input-icon">🔒</span>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field-input"
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="outletCode">
              Outlet code
            </label>
            <div className="input-wrapper">
              <span className="input-icon">🏢</span>
              <input
                id="outletCode"
                type="text"
                required
                value={outletCode}
                onChange={(e) => setOutletCode(e.target.value)}
                className="field-input"
                placeholder="Enter outlet code"
                autoComplete="organization"
              />
            </div>
            {outletCode.trim().length >= 2 && outlets.length === 0 && (
              <p className="welcome-subtitle">No active outlet matches that code.</p>
            )}
            {outlets.length > 1 && (
              <select
                id="outletId"
                required
                value={outletId}
                onChange={(e) => setOutletId(e.target.value)}
                className="field-input"
                style={{ marginTop: 8 }}
              >
                {outlets.map((outlet) => (
                  <option key={outlet.id} value={outlet.id}>
                    {outlet.name} ({outlet.code})
                  </option>
                ))}
              </select>
            )}
            {outlets.length === 1 && (
              <p className="welcome-subtitle">{outlets[0].name} ({outlets[0].code})</p>
            )}
          </div>

          <button type="submit" className="submit-btn" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign In →"}
          </button>
        </form>

        <div className="quick-access-section">
          <div className="quick-access-divider">
            <span>STAFF PIN</span>
          </div>
          <button
            type="button"
            className="fast-pin-btn"
            onClick={() => setIsPinModalOpen(true)}
            disabled={!outletId}
          >
            <span style={{ fontSize: "1.1rem" }}>⚡</span>
            <span>Fast Captain / Waiter Touch PIN Login</span>
          </button>
        </div>
      </div>

      <CaptainPinLoginModal
        isOpen={isPinModalOpen}
        onClose={() => setIsPinModalOpen(false)}
        onSuccess={() => {
          router.push("/waiter");
        }}
        outletId={outletId}
      />

      <style jsx>{`
        .login-app {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f8fafc;
          font-family: "Inter", system-ui, -apple-system, sans-serif;
          color: #0f172a;
          padding: 20px;
        }

        .login-card {
          width: 100%;
          max-width: 440px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 24px;
          padding: 40px 36px;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.05);
        }

        .brand-header {
          margin-bottom: 24px;
        }

        .welcome-title {
          font-size: 28px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 6px 0;
          letter-spacing: -0.5px;
        }

        .welcome-subtitle {
          font-size: 14px;
          color: #64748b;
          margin: 0;
          line-height: 1.5;
        }

        .notification-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 20px;
          animation: fadeIn 0.2s ease-in-out;
        }

        .notification-banner.success {
          background: #ecfdf5;
          color: #065f46;
          border: 1px solid #a7f3d0;
        }

        .notification-banner.error {
          background: #fef2f2;
          color: #991b1b;
          border: 1px solid #fecaca;
        }

        .notif-icon {
          font-size: 16px;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .field-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .field-label-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .field-label {
          font-size: 13px;
          font-weight: 600;
          color: #334155;
        }

        .forgot-password {
          font-size: 12px;
          font-weight: 600;
          color: #2563eb;
          cursor: pointer;
        }

        .forgot-password:hover {
          text-decoration: underline;
        }

        .input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .input-icon {
          position: absolute;
          left: 14px;
          font-size: 16px;
          color: #94a3b8;
          pointer-events: none;
        }

        .field-input {
          width: 100%;
          padding: 12px 14px 12px 42px;
          border-radius: 12px;
          border: 1px solid #e2e8f0;
          background: #f1f5f9;
          font-size: 14px;
          color: #0f172a;
          outline: none;
          transition: all 0.15s ease;
        }

        .field-input:focus {
          background: #ffffff;
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
        }

        .submit-btn {
          margin-top: 10px;
          padding: 14px;
          background: #0f172a;
          color: #ffffff;
          border: none;
          border-radius: 14px;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
          display: flex;
          justify-content: center;
          align-items: center;
        }

        .submit-btn:hover:not(:disabled) {
          background: #1e293b;
          transform: translateY(-1px);
        }

        .submit-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .quick-access-section {
          margin-top: 36px;
        }

        .quick-access-divider {
          display: flex;
          align-items: center;
          text-align: center;
          margin-bottom: 24px;
        }

        .quick-access-divider::before,
        .quick-access-divider::after {
          content: "";
          flex: 1;
          border-bottom: 1px solid #e2e8f0;
        }

        .quick-access-divider span {
          padding: 0 16px;
          color: #94a3b8;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1.2px;
        }

        .quick-access-buttons {
          display: flex;
          justify-content: space-around;
          align-items: center;
          gap: 16px;
        }

        .quick-access-btn {
          background: transparent;
          border: none;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          padding: 6px;
          transition: transform 0.15s ease;
        }

        .quick-access-btn:hover:not(:disabled) {
          transform: translateY(-2px);
        }

        .quick-access-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .icon-circle {
          width: 58px;
          height: 58px;
          border-radius: 50%;
          border: 1.5px solid #e2e8f0;
          background: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          box-shadow: 0 2px 6px rgba(15, 23, 42, 0.04);
          transition: all 0.2s ease;
        }

        .quick-access-btn:hover .icon-circle {
          border-color: #2563eb;
          box-shadow: 0 6px 16px rgba(37, 99, 235, 0.15);
        }

        .quick-access-btn.active .icon-circle {
          border-color: #2563eb;
          background: #eff6ff;
        }

        .role-label {
          font-size: 11px;
          font-weight: 700;
          color: #475569;
          letter-spacing: 0.5px;
        }

        .fast-pin-btn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 10px 14px;
          border-radius: 10px;
          border: 1px solid #3b82f6;
          background: #eff6ff;
          color: #1d4ed8;
          font-weight: 700;
          font-size: 0.8125rem;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .fast-pin-btn:hover {
          background: #dbeafe;
          box-shadow: 0 4px 12px rgba(37, 99, 235, 0.15);
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
