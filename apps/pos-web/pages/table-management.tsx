import React, { useEffect, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { authedFetch, useAuthGuard } from "../lib/auth";
import PetPoojaHeader from "../components/PetPoojaHeader";
import TableViewFloor from "../components/TableViewFloor";
import AddTableModal from "../components/AddTableModal";

interface DiningTable {
  id: string;
  tableNumber: string;
  capacity: number;
  section: string | null;
  status: "VACANT" | "OCCUPIED" | "BILLING" | "DIRTY";
  isActive: boolean;
}

interface KitchenStation {
  id: string;
  name: string;
  slaWarningSeconds: number;
  slaBreachSeconds: number;
}

export default function TableManagement() {
  const { me, loading: authLoading } = useAuthGuard("menu.category.manage");
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"VISUAL_FLOOR" | "TABLE_ADMIN" | "STATION_SLA">("VISUAL_FLOOR");

  const outlet = me?.outlet ?? null;
  const outletName = outlet?.name || (authLoading ? "Loading..." : "Outlet");
  const outletCode = outlet?.code || "";

  const [tables, setTables] = useState<DiningTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [newNumber, setNewNumber] = useState("");
  const [newCapacity, setNewCapacity] = useState("4");
  const [newSection, setNewSection] = useState("");
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNumber, setEditNumber] = useState("");
  const [editCapacity, setEditCapacity] = useState("");
  const [editSection, setEditSection] = useState("");

  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [stationsLoading, setStationsLoading] = useState(true);
  const [stationError, setStationError] = useState<string | null>(null);
  const [editingStationId, setEditingStationId] = useState<string | null>(null);
  const [editWarningMin, setEditWarningMin] = useState("");
  const [editBreachMin, setEditBreachMin] = useState("");
  const [savingStation, setSavingStation] = useState(false);

  const fetchTables = async () => {
    try {
      setLoading(true);
      const res = await authedFetch("/tables");
      if (res.ok) setTables(await res.json());
    } catch (e) {
      console.error("Failed to fetch tables", e);
    } finally {
      setLoading(false);
    }
  };

  const fetchStations = async () => {
    try {
      const res = await authedFetch("/kitchen/stations");
      if (res.ok) setStations(await res.json());
    } catch (e) {
      console.error("Failed to fetch kitchen stations", e);
    } finally {
      setStationsLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    fetchTables();
    fetchStations();
  }, [authLoading]);

  const startEditStation = (station: KitchenStation) => {
    setEditingStationId(station.id);
    setEditWarningMin(String(Math.round(station.slaWarningSeconds / 60)));
    setEditBreachMin(String(Math.round(station.slaBreachSeconds / 60)));
  };

  const saveStationSla = async (stationId: string) => {
    const warningMin = parseInt(editWarningMin, 10);
    const breachMin = parseInt(editBreachMin, 10);
    if (!warningMin || !breachMin || warningMin <= 0 || breachMin <= warningMin) {
      setStationError("Warning must be > 0 and breach must be greater than warning");
      return;
    }
    setSavingStation(true);
    setStationError(null);
    try {
      const res = await authedFetch(`/kitchen/stations/${stationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slaWarningSeconds: warningMin * 60, slaBreachSeconds: breachMin * 60 }),
      });
      if (res.ok) {
        setEditingStationId(null);
        fetchStations();
      } else {
        const err = await res.json();
        setStationError(err.error || "Failed to update SLA");
      }
    } catch (e) {
      setStationError("Network error updating SLA");
    } finally {
      setSavingStation(false);
    }
  };

  const addTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNumber.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authedFetch("/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableNumber: newNumber.trim(),
          capacity: parseInt(newCapacity, 10) || 4,
          section: newSection.trim() || null,
        }),
      });
      if (res.ok) {
        setNewNumber("");
        setNewSection("");
        setShowAdd(false);
        fetchTables();
      } else {
        const err = await res.json();
        setError(err.error || "Failed to create table");
      }
    } catch (e) {
      setError("Network error creating table");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (table: DiningTable) => {
    setEditingId(table.id);
    setEditNumber(table.tableNumber);
    setEditCapacity(String(table.capacity));
    setEditSection(table.section || "");
  };

  const saveEdit = async (tableId: string) => {
    try {
      const res = await authedFetch(`/tables/${tableId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableNumber: editNumber.trim(),
          capacity: parseInt(editCapacity, 10) || 4,
          section: editSection.trim() || null,
        }),
      });
      if (res.ok) {
        setEditingId(null);
        fetchTables();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const toggleActive = async (table: DiningTable) => {
    try {
      const res = await authedFetch(`/tables/${table.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !table.isActive }),
      });
      if (res.ok) {
        fetchTables();
      } else {
        const errJson = await res.json().catch(() => ({}));
        alert(errJson.error || "Failed to update table status");
      }
    } catch (e) {
      console.error(e);
      alert("Network error updating table status");
    }
  };

  return (
    <div className="table-management-root">
      <Head>
        <title>Floor Plan & Table Management - PetPooja POS</title>
      </Head>

      <PetPoojaHeader
        outletName={outletName}
        outletCode={outletCode}
        onNewOrder={() => router.push("/")}
      />

      {/* Sub-navigation tabs */}
      <div className="sub-tab-bar">
        <button
          className={`sub-tab ${activeTab === "VISUAL_FLOOR" ? "active" : ""}`}
          onClick={() => setActiveTab("VISUAL_FLOOR")}
        >
          🪑 Visual Floor Matrix (POS Live View)
        </button>
        <button
          className={`sub-tab ${activeTab === "TABLE_ADMIN" ? "active" : ""}`}
          onClick={() => setActiveTab("TABLE_ADMIN")}
        >
          ⚙️ Table Configurations & Seeding
        </button>
        <button
          className={`sub-tab ${activeTab === "STATION_SLA" ? "active" : ""}`}
          onClick={() => setActiveTab("STATION_SLA")}
        >
          ⏱️ Kitchen Station SLAs
        </button>
      </div>

      {activeTab === "VISUAL_FLOOR" ? (
        <TableViewFloor
          onSelectTable={(tbl) => {
            router.push(`/?table=${encodeURIComponent(tbl.tableNumber)}&tableId=${tbl.id}`);
          }}
          onNavigateDelivery={() => router.push("/orders?tab=online")}
          onNavigatePickup={() => router.push("/?mode=PICKUP")}
        />
      ) : activeTab === "TABLE_ADMIN" ? (
        <div className="admin-content-container">
          <div className="admin-header-row">
            <div>
              <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 800 }}>Table Management & Seeding</h2>
              <p style={{ margin: "4px 0 0 0", fontSize: "0.8125rem", color: "#64748b" }}>
                Add, modify, and organize tables across AC, Non AC, and Other restaurant sections.
              </p>
            </div>
            <button className="btn-primary-add" onClick={() => setShowAdd(true)}>
              + Add New Table
            </button>
          </div>

          {error && <div className="error-box">{error}</div>}

          {showAdd && (
            <AddTableModal
              onClose={() => setShowAdd(false)}
              onTableCreated={fetchTables}
            />
          )}

          <div className="tables-admin-table">
            <div className="table-row table-head">
              <span>TABLE NUMBER</span>
              <span>SECTION</span>
              <span>CAPACITY</span>
              <span>STATUS</span>
              <span>ACTIVE STATE</span>
              <span>ACTIONS</span>
            </div>

            {loading ? (
              <div style={{ padding: "32px", textAlign: "center", color: "#94a3b8" }}>Loading tables...</div>
            ) : tables.map((tbl) => (
              <div key={tbl.id} className="table-row">
                {editingId === tbl.id ? (
                  <>
                    <input value={editNumber} onChange={(e) => setEditNumber(e.target.value)} className="input-inline" />
                    <input value={editSection} onChange={(e) => setEditSection(e.target.value)} className="input-inline" />
                    <input type="number" value={editCapacity} onChange={(e) => setEditCapacity(e.target.value)} className="input-inline" />
                    <span>{tbl.status}</span>
                    <span>{tbl.isActive ? "Active" : "Inactive"}</span>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button onClick={() => saveEdit(tbl.id)} className="btn-save-sm">Save</button>
                      <button onClick={() => setEditingId(null)} className="btn-cancel-sm">Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <strong style={{ color: "#0f172a" }}>Table {tbl.tableNumber}</strong>
                    <span>{tbl.section || "Non AC"}</span>
                    <span>{tbl.capacity} guests</span>
                    <span className={`status-badge status-${tbl.status.toLowerCase()}`}>{tbl.status}</span>
                    <span className={tbl.isActive ? "text-active" : "text-inactive"}>
                      {tbl.isActive ? "Enabled" : "Disabled"}
                    </span>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button onClick={() => startEdit(tbl)} className="btn-edit-sm">Edit</button>
                      <button onClick={() => toggleActive(tbl)} className="btn-toggle-sm">
                        {tbl.isActive ? "Disable" : "Enable"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="admin-content-container">
          <h2 style={{ margin: "0 0 16px 0", fontSize: "1.25rem", fontWeight: 800 }}>Kitchen Station Preparation SLAs</h2>
          {stationError && <div className="error-box">{stationError}</div>}
          <div className="tables-admin-table">
            <div className="table-row table-head">
              <span>STATION NAME</span>
              <span>WARNING SLA (MINS)</span>
              <span>BREACH SLA (MINS)</span>
              <span>ACTIONS</span>
            </div>
            {stations.map((st) => (
              <div key={st.id} className="table-row">
                <strong>{st.name}</strong>
                {editingStationId === st.id ? (
                  <>
                    <input type="number" value={editWarningMin} onChange={(e) => setEditWarningMin(e.target.value)} className="input-inline" />
                    <input type="number" value={editBreachMin} onChange={(e) => setEditBreachMin(e.target.value)} className="input-inline" />
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button onClick={() => saveStationSla(st.id)} className="btn-save-sm" disabled={savingStation}>Save</button>
                      <button onClick={() => setEditingStationId(null)} className="btn-cancel-sm">Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <span>{Math.round(st.slaWarningSeconds / 60)} min</span>
                    <span>{Math.round(st.slaBreachSeconds / 60)} min</span>
                    <div>
                      <button onClick={() => startEditStation(st)} className="btn-edit-sm">Edit SLA</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <style jsx>{`
        .table-management-root {
          min-height: 100vh;
          background: #f8fafc;
          font-family: inherit;
        }

        .sub-tab-bar {
          display: flex;
          background: #ffffff;
          border-bottom: 1px solid #e2e8f0;
          padding: 0 16px;
          gap: 10px;
        }
        .sub-tab {
          background: transparent;
          border: none;
          padding: 10px 16px;
          font-size: 0.8125rem;
          font-weight: 700;
          color: #64748b;
          cursor: pointer;
        }
        .sub-tab.active {
          color: #2563eb;
          box-shadow: inset 0 -2px 0 #2563eb;
        }

        .admin-content-container {
          max-width: 1000px;
          margin: 24px auto;
          padding: 0 16px;
        }
        .admin-header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }
        .btn-primary-add {
          background: #f97316;
          color: #ffffff;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          font-weight: 700;
          font-size: 0.8125rem;
          cursor: pointer;
        }

        .tables-admin-table {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          overflow: hidden;
        }
        .table-row {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr 1fr 1fr 140px;
          padding: 12px 16px;
          align-items: center;
          border-bottom: 1px solid #f1f5f9;
          font-size: 0.8125rem;
        }
        .table-head {
          background: #f1f5f9;
          font-weight: 800;
          color: #64748b;
          font-size: 0.6875rem;
        }

        .input-inline {
          padding: 4px 8px;
          border: 1px solid #cbd5e1;
          border-radius: 4px;
          font-size: 0.8125rem;
        }
        .status-badge {
          font-size: 0.6875rem;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 4px;
          width: fit-content;
        }
        .status-vacant { background: #e2e8f0; color: #475569; }
        .status-occupied { background: #fef08a; color: #854d0e; }
        .status-billing { background: #bbf7d0; color: #166534; }
        .status-dirty { background: #fee2e2; color: #991b1b; }

        .text-active { color: #16a34a; font-weight: 600; }
        .text-inactive { color: #dc2626; font-weight: 600; }

        .btn-edit-sm, .btn-save-sm, .btn-toggle-sm, .btn-cancel-sm {
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 0.6875rem;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-edit-sm { background: #eff6ff; border: 1px solid #bfdbfe; color: #2563eb; }
        .btn-save-sm { background: #22c55e; border: none; color: #fff; }
        .btn-cancel-sm { background: #f1f5f9; border: 1px solid #cbd5e1; color: #475569; }
        .btn-toggle-sm { background: #f8fafc; border: 1px solid #cbd5e1; color: #475569; }

        .error-box {
          background: #fef2f2;
          color: #dc2626;
          padding: 8px 14px;
          border-radius: 6px;
          font-size: 0.8125rem;
          margin-bottom: 14px;
        }
      `}</style>
    </div>
  );
}
