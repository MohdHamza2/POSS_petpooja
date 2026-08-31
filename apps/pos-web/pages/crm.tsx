import React, { useEffect, useState } from "react";
import Head from "next/head";
import { authedFetch, useAuthGuard } from "../lib/auth";
import Nav from "../components/Nav";

// Real response shape of GET /customers/:id and POST /customers
// (services/crm/src/customer-manager.ts CustomerManager, Prisma Customer model —
// kapmeta/schema.prisma model Customer). loyaltyPoints is a plain Int (not a
// bigint minor-unit field), so no string serialization is needed for it.
interface CustomerApi {
  id: string;
  outletId: string;
  firstName: string;
  lastName: string | null;
  phone: string;
  email: string | null;
  loyaltyPoints: number;
  createdAt: string;
  updatedAt: string;
}

export default function CrmPage() {
  // crm.ts checks requirePermission("crm.read") on GET /customers/:id and
  // requirePermission("crm.write") on POST /customers and POST /loyalty/redeem —
  // the frontend gate matches the exact "crm.read" action the lookup below needs.
  const { me, loading: authLoading } = useAuthGuard("crm.read");

  const [lookupId, setLookupId] = useState("");
  const [customer, setCustomer] = useState<CustomerApi | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newBirthDate, setNewBirthDate] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<CustomerApi | null>(null);

  const [redeemPoints, setRedeemPoints] = useState("");
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);

  const [directorySearch, setDirectorySearch] = useState("");
  const [directoryCustomers, setDirectoryCustomers] = useState<CustomerApi[]>([]);
  const [directoryTotal, setDirectoryTotal] = useState(0);
  const [directoryOffset, setDirectoryOffset] = useState(0);
  const directoryLimit = 25;
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [directoryLoaded, setDirectoryLoaded] = useState(false);

  const canWrite = me?.permissions.includes("crm.write") ?? false;
  const [loyaltyPaise, setLoyaltyPaise] = useState("");
  const [gstin, setGstin] = useState("");
  const [outletSaveMsg, setOutletSaveMsg] = useState<string | null>(null);
  const [outletSaving, setOutletSaving] = useState(false);

  useEffect(() => {
    if (authLoading || !me) return;
    authedFetch("/settings/outlet")
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        setLoyaltyPaise(data.loyaltyPaisePerPoint != null ? String(data.loyaltyPaisePerPoint) : "");
        setGstin(data.taxNumber || "");
      })
      .catch(() => undefined);
  }, [authLoading, me]);

  const saveOutletSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setOutletSaving(true);
    setOutletSaveMsg(null);
    authedFetch("/settings/outlet", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loyaltyPaisePerPoint: loyaltyPaise.trim() === "" ? null : loyaltyPaise.trim(),
        taxNumber: gstin.trim() === "" ? null : gstin.trim(),
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to save outlet settings");
        }
        setOutletSaveMsg("Saved. New settles use this loyalty rate and GSTIN.");
      })
      .catch((err) => {
        setOutletSaveMsg(err instanceof Error ? err.message : "Save failed");
      })
      .finally(() => setOutletSaving(false));
  };

  const runLookup = (id: string) => {
    if (!id.trim()) return;
    setLookupLoading(true);
    setLookupError(null);
    setSearched(true);
    authedFetch(`/crm/customers/${encodeURIComponent(id.trim())}`)
      .then(async (res) => {
        if (res.status === 404) {
          setCustomer(null);
          setLookupError(null);
          setLookupLoading(false);
          return;
        }
        if (!res.ok) throw new Error("HTTP error " + res.status);
        const data = (await res.json()) as CustomerApi;
        setCustomer(data);
        setLookupLoading(false);
      })
      .catch((err) => {
        setLookupError(err instanceof Error ? err.message : "Failed to look up customer");
        setCustomer(null);
        setLookupLoading(false);
      });
  };

  const submitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFirstName.trim() || !newPhone.trim()) return;
    setCreateLoading(true);
    setCreateError(null);
    setCreateSuccess(null);
    authedFetch(`/crm/customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: newFirstName.trim(),
        lastName: newLastName.trim() || undefined,
        phone: newPhone.trim(),
        email: newEmail.trim() || undefined,
        birthDate: newBirthDate || undefined,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "HTTP error " + res.status);
        }
        const data = (await res.json()) as CustomerApi;
        setCreateSuccess(data);
        setNewFirstName("");
        setNewLastName("");
        setNewPhone("");
        setNewEmail("");
        setNewBirthDate("");
        setCreateLoading(false);
      })
      .catch((err) => {
        setCreateError(err instanceof Error ? err.message : "Failed to create customer");
        setCreateLoading(false);
      });
  };

  const submitRedeem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer || !redeemPoints.trim()) return;
    setRedeemLoading(true);
    setRedeemError(null);
    authedFetch(`/crm/loyalty/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: customer.id, points: Number(redeemPoints) }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "HTTP error " + res.status);
        }
        const data = (await res.json()) as CustomerApi;
        setCustomer(data);
        setRedeemPoints("");
        setRedeemLoading(false);
      })
      .catch((err) => {
        setRedeemError(err instanceof Error ? err.message : "Failed to redeem points");
        setRedeemLoading(false);
      });
  };

  const loadDirectory = (offset: number) => {
    setDirectoryLoading(true);
    setDirectoryError(null);
    setDirectoryLoaded(true);
    const params = new URLSearchParams();
    if (directorySearch.trim()) params.set("search", directorySearch.trim());
    params.set("limit", String(directoryLimit));
    params.set("offset", String(offset));
    authedFetch(`/crm/customers?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("HTTP error " + res.status);
        const data = (await res.json()) as { customers: CustomerApi[]; total: number; limit: number; offset: number };
        setDirectoryCustomers(data.customers);
        setDirectoryTotal(data.total);
        setDirectoryOffset(data.offset);
        setDirectoryLoading(false);
      })
      .catch((err) => {
        setDirectoryError(err instanceof Error ? err.message : "Failed to load customers");
        setDirectoryCustomers([]);
        setDirectoryLoading(false);
      });
  };

  useEffect(() => {
    if (!authLoading && me?.permissions.includes("crm.read") && !directoryLoaded) {
      loadDirectory(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, me]);

  const initials = me?.name
    ? me.name
        .split(" ")
        .map((p) => p.charAt(0))
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?";

  return (
    <div className="admin-app">
      <Head>
        <title>Kapmeta POS - Customers & Loyalty</title>
        <meta name="description" content="Customer lookup, creation, and loyalty point redemption." />
      </Head>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <Nav variant="sidebar" />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand-badge">
            <span className="brand-icon">⚡</span>
            <span className="brand-name">Kapmeta CRM</span>
          </div>
        </div>

        <div className="topbar-right">
          <div className="user-profile-badge">
            <div className="avatar-circle">{initials}</div>
            <div className="user-info-text">
              <span className="user-name">{me?.name ?? "Loading..."}</span>
              <span className="user-role">{me?.roles?.[0] ?? ""}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="dashboard-body">
        {authLoading && (
          <div className="empty-state-card">
            <span className="empty-icon">🔐</span>
            <h3>Checking access...</h3>
          </div>
        )}

        {!authLoading && me && !me.permissions.includes("crm.read") && (
          <div className="empty-state-card">
            <span className="empty-icon">🚫</span>
            <h3>No CRM access</h3>
            <p>Your role does not grant the "crm.read" permission required to view customers.</p>
          </div>
        )}

        {!authLoading && me && me.permissions.includes("crm.read") && (
          <>
            <section className="dashboard-greeting-row">
              <div>
                <span className="breadcrumb-line">Operations &gt; Customers & Loyalty</span>
                <h1 className="greeting-title">Customer Lookup</h1>
                <p className="greeting-subtitle">
                  Look up a customer by exact ID below, or browse/search the full directory
                  further down the page.
                </p>
              </div>
            </section>

            <section className="panel-card">
              <div className="panel-header">
                <div>
                  <h3>Find a Customer</h3>
                  <p className="panel-sub">From GET /customers/:id</p>
                </div>
              </div>
              <form
                className="lookup-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  runLookup(lookupId);
                }}
              >
                <input
                  type="text"
                  className="text-input"
                  placeholder="Customer ID (UUID)"
                  value={lookupId}
                  onChange={(e) => setLookupId(e.target.value)}
                />
                <button type="submit" className="export-btn" disabled={lookupLoading}>
                  {lookupLoading ? "Searching..." : "Search"}
                </button>
              </form>

              {lookupError && (
                <div className="not-available-box">
                  <p>{lookupError}</p>
                </div>
              )}

              {!lookupLoading && searched && !lookupError && !customer && (
                <div className="not-available-box">
                  <p>No customer found for that ID.</p>
                </div>
              )}

              {customer && (
                <div className="customer-detail">
                  <div className="kpi-cards-grid">
                    <div className="kpi-card">
                      <div className="kpi-top">
                        <div className="icon-badge blue">
                          <span>👤</span>
                        </div>
                        <span className="kpi-heading">NAME</span>
                      </div>
                      <div className="kpi-main">
                        <h2 className="kpi-number" style={{ fontSize: "1.25rem" }}>
                          {customer.firstName} {customer.lastName ?? ""}
                        </h2>
                      </div>
                    </div>

                    <div className="kpi-card">
                      <div className="kpi-top">
                        <div className="icon-badge amber">
                          <span>📞</span>
                        </div>
                        <span className="kpi-heading">PHONE</span>
                      </div>
                      <div className="kpi-main">
                        <h2 className="kpi-number" style={{ fontSize: "1.25rem" }}>{customer.phone}</h2>
                      </div>
                    </div>

                    <div className="kpi-card">
                      <div className="kpi-top">
                        <div className="icon-badge purple">
                          <span>✉️</span>
                        </div>
                        <span className="kpi-heading">EMAIL</span>
                      </div>
                      <div className="kpi-main">
                        <h2 className="kpi-number" style={{ fontSize: "1.25rem" }}>{customer.email ?? "—"}</h2>
                      </div>
                    </div>

                    <div className="kpi-card">
                      <div className="kpi-top">
                        <div className="icon-badge green">
                          <span>★</span>
                        </div>
                        <span className="kpi-heading">LOYALTY POINTS</span>
                      </div>
                      <div className="kpi-main">
                        <h2 className="kpi-number">{customer.loyaltyPoints ?? 0}</h2>
                      </div>
                    </div>
                  </div>

                  {canWrite && (
                    <form className="lookup-form redeem-form" onSubmit={submitRedeem}>
                      <input
                        type="number"
                        min={1}
                        className="text-input"
                        placeholder="Points to redeem"
                        value={redeemPoints}
                        onChange={(e) => setRedeemPoints(e.target.value)}
                      />
                      <button type="submit" className="export-btn" disabled={redeemLoading}>
                        {redeemLoading ? "Redeeming..." : "Redeem Points"}
                      </button>
                    </form>
                  )}
                  {redeemError && (
                    <div className="not-available-box">
                      <p>{redeemError}</p>
                    </div>
                  )}
                  {!canWrite && (
                    <p className="panel-sub">
                      Redeeming points requires the "crm.write" permission (POST /loyalty/redeem),
                      which your role does not have.
                    </p>
                  )}
                </div>
              )}
            </section>

            {canWrite && (
              <section className="panel-card">
                <div className="panel-header">
                  <div>
                    <h3>Outlet loyalty & GSTIN</h3>
                    <p className="panel-sub">
                      Paise spent per 1 loyalty point (10000 = ₹100 per point). GSTIN prints on receipts.
                    </p>
                  </div>
                </div>
                <form className="create-form" onSubmit={saveOutletSettings}>
                  <input
                    type="number"
                    min={1}
                    className="text-input"
                    placeholder="Paise per point"
                    value={loyaltyPaise}
                    onChange={(e) => setLoyaltyPaise(e.target.value)}
                  />
                  <input
                    type="text"
                    className="text-input"
                    placeholder="GSTIN"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value)}
                  />
                  <button type="submit" className="export-btn" disabled={outletSaving}>
                    {outletSaving ? "Saving..." : "Save"}
                  </button>
                </form>
                {outletSaveMsg && <p className="panel-sub">{outletSaveMsg}</p>}
              </section>
            )}

            {canWrite ? (
              <section className="panel-card">
                <div className="panel-header">
                  <div>
                    <h3>Register New Customer</h3>
                    <p className="panel-sub">Writes to POST /customers — real insert, no mock data</p>
                  </div>
                </div>
                <form className="create-form" onSubmit={submitCreate}>
                  <input
                    type="text"
                    className="text-input"
                    placeholder="First name *"
                    value={newFirstName}
                    onChange={(e) => setNewFirstName(e.target.value)}
                  />
                  <input
                    type="text"
                    className="text-input"
                    placeholder="Last name"
                    value={newLastName}
                    onChange={(e) => setNewLastName(e.target.value)}
                  />
                  <input
                    type="text"
                    className="text-input"
                    placeholder="Phone *"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                  />
                  <input
                    type="email"
                    className="text-input"
                    placeholder="Email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                  />
                  <input
                    type="date"
                    className="text-input"
                    placeholder="Birth Date (YYYY-MM-DD)"
                    title="Customer Date of Birth"
                    value={newBirthDate}
                    onChange={(e) => setNewBirthDate(e.target.value)}
                  />
                  <button type="submit" className="export-btn" disabled={createLoading}>
                    {createLoading ? "Creating..." : "Create Customer"}
                  </button>
                </form>
                {createError && (
                  <div className="not-available-box">
                    <p>{createError}</p>
                  </div>
                )}
                {createSuccess && (
                  <div className="not-available-box success">
                    <p>
                      Created customer <strong>{createSuccess.firstName} {createSuccess.lastName ?? ""}</strong> with
                      ID <code>{createSuccess.id}</code>. Use the lookup above to view it.
                    </p>
                  </div>
                )}
              </section>
            ) : (
              <section className="panel-card">
                <div className="panel-header">
                  <div>
                    <h3>Register New Customer</h3>
                    <p className="panel-sub">Requires the "crm.write" permission</p>
                  </div>
                  <span className="pill-status muted">Not available</span>
                </div>
                <div className="not-available-box">
                  <p>Your role does not grant "crm.write", which POST /customers requires.</p>
                </div>
              </section>
            )}

            <section className="panel-card">
              <div className="panel-header">
                <div>
                  <h3>Customer Directory</h3>
                  <p className="panel-sub">From GET /customers — search by name or phone</p>
                </div>
              </div>

              <form
                className="lookup-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  loadDirectory(0);
                }}
              >
                <input
                  type="text"
                  className="text-input"
                  placeholder="Search by name or phone"
                  value={directorySearch}
                  onChange={(e) => setDirectorySearch(e.target.value)}
                />
                <button type="submit" className="export-btn" disabled={directoryLoading}>
                  {directoryLoading ? "Searching..." : "Search"}
                </button>
              </form>

              {directoryError && (
                <div className="not-available-box">
                  <p>{directoryError}</p>
                </div>
              )}

              {!directoryLoading && !directoryError && directoryLoaded && directoryCustomers.length === 0 && (
                <div className="not-available-box">
                  <p>No customers found.</p>
                </div>
              )}

              {directoryCustomers.length > 0 && (
                <>
                  <div className="directory-table-wrap">
                    <table className="directory-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Phone</th>
                          <th>Email</th>
                          <th>Loyalty Points</th>
                        </tr>
                      </thead>
                      <tbody>
                        {directoryCustomers.map((c) => (
                          <tr
                            key={c.id}
                            className="directory-row"
                            onClick={() => {
                              setLookupId(c.id);
                              runLookup(c.id);
                            }}
                          >
                            <td>{c.firstName} {c.lastName ?? ""}</td>
                            <td>{c.phone}</td>
                            <td>{c.email ?? "—"}</td>
                            <td>{c.loyaltyPoints}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="directory-pagination">
                    <span className="panel-sub">
                      Showing {directoryOffset + 1}–{Math.min(directoryOffset + directoryCustomers.length, directoryTotal)} of {directoryTotal}
                    </span>
                    <div className="directory-pagination-btns">
                      <button
                        type="button"
                        className="export-btn"
                        disabled={directoryLoading || directoryOffset === 0}
                        onClick={() => loadDirectory(Math.max(directoryOffset - directoryLimit, 0))}
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        className="export-btn"
                        disabled={directoryLoading || directoryOffset + directoryLimit >= directoryTotal}
                        onClick={() => loadDirectory(directoryOffset + directoryLimit)}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        .admin-app {
          display: flex;
          flex-direction: column;
          min-height: 100vh;
          width: 100vw;
          background-color: var(--bg-base);
          color: var(--text-primary);
        }

        .topbar {
          height: 64px;
          background-color: var(--bg-card);
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 24px;
          position: sticky;
          top: 0;
          z-index: 20;
        }

        .topbar-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .brand-badge {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .brand-icon {
          width: 32px;
          height: 32px;
          border-radius: var(--radius-sm);
          background: var(--dark-btn);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1rem;
        }

        .brand-name {
          font-size: 1.125rem;
          font-weight: 800;
          letter-spacing: -0.5px;
        }

        .topbar-right {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .user-profile-badge {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .avatar-circle {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          background: #e2e8f0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 0.8125rem;
        }

        .user-info-text {
          display: flex;
          flex-direction: column;
        }

        .user-name {
          font-size: 0.8125rem;
          font-weight: 700;
          line-height: 1.2;
        }

        .user-role {
          font-size: 0.6875rem;
          color: var(--text-secondary);
        }

        .dashboard-body {
          padding: 24px 32px;
          display: flex;
          flex-direction: column;
          gap: 24px;
          max-width: 1200px;
          margin: 0 auto;
          width: 100%;
        }

        .dashboard-greeting-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          padding-bottom: 8px;
        }

        .breadcrumb-line {
          font-size: 0.75rem;
          color: var(--text-muted);
          font-weight: 600;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }

        .greeting-title {
          margin: 4px 0 2px 0;
          font-size: 1.75rem;
          font-weight: 800;
          letter-spacing: -0.5px;
        }

        .greeting-subtitle {
          margin: 0;
          font-size: 0.875rem;
          color: var(--text-secondary);
          max-width: 640px;
        }

        .panel-card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 24px;
          box-shadow: var(--shadow-card);
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }

        .panel-header h3 {
          margin: 0 0 2px 0;
          font-size: 1.125rem;
          font-weight: 800;
        }

        .panel-sub {
          margin: 0;
          font-size: 0.75rem;
          color: var(--text-secondary);
        }

        .pill-status {
          padding: 4px 10px;
          border-radius: var(--radius-pill);
          font-size: 0.75rem;
          font-weight: 700;
        }

        .pill-status.muted {
          background: var(--bg-subtle);
          color: var(--text-muted);
        }

        .not-available-box {
          background: var(--bg-subtle);
          border: 1px dashed var(--border);
          border-radius: var(--radius-md);
          padding: 16px;
          font-size: 0.8125rem;
          color: var(--text-secondary);
        }

        .not-available-box.success {
          border-style: solid;
          border-color: #10b981;
          color: var(--text-primary);
        }

        .not-available-box p {
          margin: 0;
        }

        .lookup-form,
        .create-form {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          align-items: center;
        }

        .redeem-form {
          margin-top: 8px;
        }

        .text-input {
          flex: 1 1 200px;
          padding: 9px 14px;
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          font-size: 0.8125rem;
          background: var(--bg-card);
          color: var(--text-primary);
          min-width: 160px;
        }

        .export-btn {
          padding: 8px 18px;
          background: var(--dark-btn);
          color: #fff;
          border: none;
          border-radius: var(--radius-pill);
          font-size: 0.8125rem;
          font-weight: 700;
          cursor: pointer;
          min-height: 38px;
        }

        .export-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .customer-detail {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .kpi-cards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 18px;
        }

        .kpi-card {
          background: var(--bg-subtle);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 18px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .kpi-top {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .icon-badge {
          width: 36px;
          height: 36px;
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1rem;
          font-weight: 800;
        }

        .icon-badge.green {
          background: #ecfdf5;
          color: #065f46;
        }

        .icon-badge.blue {
          background: #eff6ff;
          color: #1d4ed8;
        }

        .icon-badge.amber {
          background: #fffbeb;
          color: #92400e;
        }

        .icon-badge.purple {
          background: #faf5ff;
          color: #7e22ce;
        }

        .kpi-heading {
          font-size: 0.6875rem;
          font-weight: 700;
          color: var(--text-muted);
          letter-spacing: 0.5px;
        }

        .kpi-number {
          margin: 0;
          font-size: 1.875rem;
          font-weight: 800;
          letter-spacing: -0.5px;
        }

        .empty-state-card {
          text-align: center;
          padding: 60px 20px;
          background: var(--bg-card);
          border: 1px dashed var(--border);
          border-radius: var(--radius-lg);
        }

        .empty-icon {
          font-size: 40px;
          display: block;
          margin-bottom: 12px;
        }

        .directory-table-wrap {
          overflow-x: auto;
        }

        .directory-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.8125rem;
        }

        .directory-table th {
          text-align: left;
          padding: 10px 12px;
          font-size: 0.6875rem;
          font-weight: 700;
          color: var(--text-muted);
          letter-spacing: 0.5px;
          text-transform: uppercase;
          border-bottom: 1px solid var(--border);
        }

        .directory-table td {
          padding: 10px 12px;
          border-bottom: 1px solid var(--border);
        }

        .directory-row {
          cursor: pointer;
        }

        .directory-row:hover {
          background: var(--bg-subtle);
        }

        .directory-pagination {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
        }

        .directory-pagination-btns {
          display: flex;
          gap: 8px;
        }
      ` }} />
      </div>
      </div>
    </div>
  );
}
