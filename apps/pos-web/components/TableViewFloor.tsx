import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { authedFetch } from "../lib/auth";
import { useKapmetaSocket } from "../lib/useKapmetaSocket";
import MoveKotModal from "./MoveKotModal";
import AddTableModal from "./AddTableModal";

interface TableItem {
  id: string;
  tableNumber: string;
  capacity: number;
  section: string | null;
  status: "VACANT" | "RUNNING" | "PRINTED" | "PAID" | "RUNNING_KOT" | "DIRTY";
  kitchenStage?: "QUEUED" | "COOKING" | "READY" | "SERVED" | null;
  activeOrderId?: string | null;
  totalMinor?: number;
  elapsedMinutes?: number;
  itemCount?: number;
  currentOrder?: any;
  mergeGroupId?: string | null;
  mergePrimaryTableId?: string | null;
  mergedWith?: string[];
  isMergePrimary?: boolean;
}

interface TableViewFloorProps {
  onSelectTable?: (table: TableItem) => void;
  onNavigateDelivery?: () => void;
  onNavigatePickup?: () => void;
}

export default function TableViewFloor({
  onSelectTable,
  onNavigateDelivery,
  onNavigatePickup,
}: TableViewFloorProps) {
  const router = useRouter();
  const [tables, setTables] = useState<TableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [isMoveKotOpen, setIsMoveKotOpen] = useState(false);
  const [isAddTableOpen, setIsAddTableOpen] = useState(false);
  const [inspectTable, setInspectTable] = useState<TableItem | null>(null);
  const [inspectOrderDetails, setInspectOrderDetails] = useState<any | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const fetchTablesData = async () => {
    try {
      setLoading(true);
      const res = await authedFetch("/tables");
      if (res.ok) {
        const data = await res.json();
        const mapped: TableItem[] = (data || []).map((tbl: any) => {
          const currentOrder = tbl.currentOrder || null;
          const status: TableItem["status"] = currentOrder
            ? ((tbl.status as any) || "RUNNING")
            : tbl.mergeGroupId
              ? "RUNNING"
              : "VACANT";
          const queuedKot = (currentOrder?.kots || []).some((k: any) =>
            k.status === "QUEUED" || k.status === "KOT_CREATED" || k.status === "PENDING"
          );
          let kitchenStage: TableItem["kitchenStage"] = currentOrder ? ((tbl.kitchenStage as any) || null) : null;
          if (kitchenStage === "QUEUED" && !queuedKot) kitchenStage = null;
          let elapsedMinutes: number | undefined;
          if (currentOrder?.createdAt) {
            const created = new Date(currentOrder.createdAt).getTime();
            elapsedMinutes = Math.max(1, Math.floor((Date.now() - created) / 60000));
          }

          return {
            id: tbl.id,
            tableNumber: tbl.tableNumber,
            capacity: tbl.capacity || 4,
            section: tbl.section || "Non AC",
            status,
            kitchenStage,
            activeOrderId: currentOrder?.id || tbl.activeOrderId || null,
            totalMinor: Number(currentOrder?.grandTotalPaise || 0),
            elapsedMinutes,
            itemCount: currentOrder?.items?.length || 0,
            currentOrder,
            mergeGroupId: tbl.mergeGroupId || null,
            mergePrimaryTableId: tbl.mergePrimaryTableId || null,
            mergedWith: Array.isArray(tbl.mergedWith) ? tbl.mergedWith : [],
            isMergePrimary: !!tbl.isMergePrimary,
          };
        });


        setTables(mapped);
      }
    } catch (e) {
      console.error("Failed to load tables", e);
    } finally {
      setLoading(false);
    }
  };

  const handleServeTable = async (e: React.MouseEvent, tbl: TableItem) => {
    e.stopPropagation();
    try {
      const res = await authedFetch(`/tables/${tbl.id}/serve`, { method: "POST" });
      if (res.ok) {
        setActionFeedback(`Table ${tbl.tableNumber} marked served.`);
        setTimeout(() => setActionFeedback(null), 4000);
        await fetchTablesData();
        return;
      }
      const errJson = await res.json().catch(() => ({}));
      setActionFeedback(errJson.error || `Could not serve table ${tbl.tableNumber}.`);
      setTimeout(() => setActionFeedback(null), 5000);
    } catch (err) {
      console.error("Failed to serve table food", err);
      setActionFeedback(`Network error serving table ${tbl.tableNumber}.`);
      setTimeout(() => setActionFeedback(null), 5000);
    }
  };

  const handleVacateTable = async (e: React.MouseEvent, tbl: TableItem) => {
    e.stopPropagation();
    try {
      const res = await authedFetch(`/tables/${tbl.id}/vacant`, { method: "POST" });
      if (res.ok) {
        setActionFeedback(`Table ${tbl.tableNumber} marked vacant.`);
        setTimeout(() => setActionFeedback(null), 4000);
        await fetchTablesData();
        return;
      }
      const errJson = await res.json().catch(() => ({}));
      setActionFeedback(errJson.error || `Could not vacate table ${tbl.tableNumber}.`);
      setTimeout(() => setActionFeedback(null), 5000);
    } catch (err) {
      console.error("Failed to vacate table", err);
      setActionFeedback(`Network error vacating table ${tbl.tableNumber}.`);
      setTimeout(() => setActionFeedback(null), 5000);
    }
  };

  useKapmetaSocket(() => {
    fetchTablesData();
  }, true, "pos-floor");

  useEffect(() => {
    fetchTablesData();
    const timer = setInterval(fetchTablesData, 10000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSourceIds, setMergeSourceIds] = useState<string[]>([]);
  const [mergeFeedback, setMergeFeedback] = useState<string | null>(null);

  const toggleMergeSource = (tbl: TableItem) => {
    setMergeSourceIds((prev) =>
      prev.includes(tbl.id) ? prev.filter((id) => id !== tbl.id) : [...prev, tbl.id]
    );
  };

  const completeMerge = async (targetTable: TableItem) => {
    if (mergeSourceIds.length === 0) {
      alert("Please select at least one occupied source table to merge.");
      return;
    }
    try {
      const res = await authedFetch("/tables/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceTableIds: mergeSourceIds, targetTableId: targetTable.id }),
      });
      if (res.ok) {
        setMergeSourceIds([]);
        setMergeMode(false);
        setMergeFeedback(`Successfully merged tables into Table ${targetTable.tableNumber}!`);
        setTimeout(() => setMergeFeedback(null), 5000);
        await fetchTablesData();
      } else {
        const errJson = await res.json().catch(() => ({}));
        alert(errJson.error || "Failed to merge tables");
      }
    } catch (e: any) {
      alert("Network error merging tables");
    }
  };

  const handleTableClick = (tbl: TableItem) => {
    if (mergeMode) {
      if (mergeSourceIds.includes(tbl.id)) {
        toggleMergeSource(tbl);
      } else if (mergeSourceIds.length > 0 && !mergeSourceIds.includes(tbl.id)) {
        // Tap this table as target destination
        completeMerge(tbl);
      } else {
        toggleMergeSource(tbl);
      }
      return;
    }

    if (onSelectTable) {
      onSelectTable(tbl);
    } else {
      router.push(`/?table=${encodeURIComponent(tbl.tableNumber)}&tableId=${tbl.id}`);
    }
  };

  const handleInspect = async (e: React.MouseEvent, tbl: TableItem) => {
    e.stopPropagation();
    setInspectTable(tbl);
    if (tbl.activeOrderId) {
      try {
        const res = await authedFetch(`/orders/${tbl.activeOrderId}`);
        if (res.ok) {
          const detail = await res.json();
          setInspectOrderDetails(detail);
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      setInspectOrderDetails(null);
    }
  };

  const handleQuickPrint = (e: React.MouseEvent, tbl: TableItem) => {
    e.stopPropagation();
    if (!tbl.activeOrderId) {
      alert(`Table ${tbl.tableNumber} is vacant.`);
      return;
    }
    // Trigger thermal print job
    authedFetch(`/orders/${tbl.activeOrderId}/print`, { method: "POST" })
      .then((res) => {
        if (res.ok) alert(`KOT/Bill sent to Thermal Printer for Table ${tbl.tableNumber}`);
        else alert(`Print command sent.`);
      })
      .catch(() => alert("Printing..."));
  };

  // Group tables by section
  const sections = useMemo(() => {
    const map = new Map<string, TableItem[]>();
    tables.forEach((t) => {
      if (statusFilter) {
        if (statusFilter === "RUNNING") {
          if (t.status !== "RUNNING" && t.status !== "RUNNING_KOT") return;
        } else if (t.status !== statusFilter) {
          return;
        }
      }
      const sec = t.section || "Non AC";
      if (!map.has(sec)) map.set(sec, []);
      map.get(sec)!.push(t);
    });
    return Array.from(map.entries());
  }, [tables, statusFilter]);

  return (
    <div className="table-view-container">
      {/* Subheader Toolbar */}
      <div className="table-view-toolbar">
        <div className="toolbar-left">
          <h2 className="toolbar-title">Table View</h2>
          <button
            type="button"
            className="btn-move-kot"
            onClick={() => setIsMoveKotOpen(true)}
          >
            Move KOT / Items
          </button>
          <button
            type="button"
            className={`btn-move-kot ${mergeMode ? "active-merge" : ""}`}
            style={mergeMode ? { background: "#4f46e5", color: "#fff", borderColor: "#6366f1" } : {}}
            onClick={() => {
              setMergeMode((v) => !v);
              setMergeSourceIds([]);
            }}
          >
            {mergeMode ? "✕ Cancel Merge" : "🔀 Merge Tables"}
          </button>

          {/* Status Color Legend Pills */}
          <div className="status-legend-group">
            <button
              className={`legend-pill ${statusFilter === null ? "active" : ""}`}
              onClick={() => setStatusFilter(null)}
            >
              All Tables
            </button>
            <button
              className={`legend-pill ${statusFilter === "VACANT" ? "active" : ""}`}
              onClick={() => setStatusFilter(statusFilter === "VACANT" ? null : "VACANT")}
            >
              <span className="dot dot-blank"></span> Blank Table
            </button>
            <button
              className={`legend-pill ${statusFilter === "RUNNING" ? "active" : ""}`}
              onClick={() => setStatusFilter(statusFilter === "RUNNING" ? null : "RUNNING")}
            >
              <span className="dot dot-running"></span> Running Table
            </button>
            <button
              className={`legend-pill ${statusFilter === "PRINTED" ? "active" : ""}`}
              onClick={() => setStatusFilter(statusFilter === "PRINTED" ? null : "PRINTED")}
            >
              <span className="dot dot-printed"></span> Printed Table
            </button>
            <button
              className={`legend-pill ${statusFilter === "PAID" ? "active" : ""}`}
              onClick={() => setStatusFilter(statusFilter === "PAID" ? null : "PAID")}
            >
              <span className="dot dot-paid"></span> Paid Table
            </button>
            <button
              className={`legend-pill ${statusFilter === "RUNNING_KOT" ? "active" : ""}`}
              onClick={() => setStatusFilter(statusFilter === "RUNNING_KOT" ? null : "RUNNING_KOT")}
            >
              <span className="dot dot-running-kot"></span> Running KOT Table
            </button>
          </div>
        </div>

        <div className="toolbar-right">
          <button
            type="button"
            className="btn-toolbar-icon"
            onClick={fetchTablesData}
            title="Refresh Table Floor"
          >
            🔄
          </button>

          <button
            type="button"
            className="btn-add-table"
            onClick={() => setIsAddTableOpen(true)}
          >
            Add Table
          </button>

          <button
            type="button"
            className="btn-delivery-jump"
            onClick={() => {
              if (onNavigateDelivery) onNavigateDelivery();
              else router.push("/orders?tab=online");
            }}
          >
            Delivery
          </button>

          <button
            type="button"
            className="btn-pickup-jump"
            onClick={() => {
              if (onNavigatePickup) onNavigatePickup();
              else router.push("/?mode=PICKUP");
            }}
          >
            Pick Up
          </button>
        </div>
      </div>

      {mergeMode && (
        <div style={{ background: "#312e81", color: "#e0e7ff", padding: "10px 20px", fontSize: "0.8125rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>
            {mergeSourceIds.length === 0
              ? "🔀 Step 1: Click one or more occupied tables to select source orders."
              : `🔀 Selected ${mergeSourceIds.length} source table(s). Step 2: Click the target table to merge all orders into.`}
          </span>
          <button
            style={{ background: "#4338ca", color: "#fff", border: "none", padding: "4px 12px", borderRadius: "6px", cursor: "pointer", fontSize: "0.75rem" }}
            onClick={() => {
              setMergeMode(false);
              setMergeSourceIds([]);
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {mergeFeedback && (
        <div style={{ background: "#065f46", color: "#ecfdf5", padding: "10px 20px", fontSize: "0.8125rem", fontWeight: 600 }}>
          {mergeFeedback}
        </div>
      )}
      {actionFeedback && (
        <div style={{ background: "#1e3a5f", color: "#e0f2fe", padding: "10px 20px", fontSize: "0.8125rem", fontWeight: 600 }}>
          {actionFeedback}
        </div>
      )}

      {/* Floor Matrix Grid */}
      <div className="floor-matrix-scroll">
        {loading && tables.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px", color: "#94a3b8" }}>
            Loading floor sections and tables...
          </div>
        ) : sections.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px", color: "#94a3b8" }}>
            No tables match the selected filter.
          </div>
        ) : (
          sections.map(([sectionName, secTables]) => (
            <div key={sectionName} className="floor-section-block">
              <h3 className="section-title-label">{sectionName}</h3>
              <div className="tables-grid">
                {secTables.map((tbl) => {
                  const isOccupied = tbl.status !== "VACANT";
                  const cardClass =
                    tbl.status === "RUNNING_KOT"
                      ? "card-running-kot"
                      : tbl.status === "PRINTED"
                      ? "card-printed"
                      : tbl.status === "PAID"
                      ? "card-paid"
                      : tbl.status === "RUNNING"
                      ? "card-running"
                      : "card-blank";

                  const isMergeSelected = mergeSourceIds.includes(tbl.id);
                  return (
                    <div
                      key={tbl.id}
                      className={`table-card ${cardClass} ${isMergeSelected ? "selected-merge-source" : ""}`}
                      style={isMergeSelected ? { outline: "3px solid #6366f1", transform: "scale(1.03)", boxShadow: "0 0 15px rgba(99, 102, 241, 0.5)" } : {}}
                      onClick={() => handleTableClick(tbl)}
                    >
                      <div className="card-top-info">
                        {isOccupied && tbl.elapsedMinutes ? (
                          <span className="elapsed-badge">{tbl.elapsedMinutes} Min</span>
                        ) : (
                          <span className="blank-spacer"></span>
                        )}
                        <span className="table-code-name">{tbl.tableNumber}</span>
                        {tbl.mergedWith && tbl.mergedWith.length > 1 && (
                          <span
                            style={{
                              fontSize: "9px",
                              fontWeight: 700,
                              color: "#c4b5fd",
                              background: "rgba(99, 102, 241, 0.25)",
                              border: "1px solid rgba(129, 140, 248, 0.5)",
                              borderRadius: "4px",
                              padding: "1px 5px",
                              marginLeft: 4,
                            }}
                          >
                            Merged {tbl.mergedWith.join(" + ")}
                          </span>
                        )}
                        {isOccupied && tbl.totalMinor ? (
                          <span className="table-amount">₹{(tbl.totalMinor / 100).toFixed(2)}</span>
                        ) : (
                          <span className="blank-amount"></span>
                        )}
                      </div>

                      {isOccupied && tbl.kitchenStage && (
                        <div style={{ margin: "2px 0 4px 0", textAlign: "center", display: "flex", justifyContent: "center" }}>
                          {tbl.kitchenStage === "COOKING" && (
                            <span style={{ fontSize: "10px", background: "rgba(245, 158, 11, 0.2)", color: "#fbbf24", border: "1px solid rgba(245, 158, 11, 0.5)", borderRadius: "4px", padding: "1px 6px", fontWeight: 700 }}>
                              👨‍🍳 Cooking
                            </span>
                          )}
                          {tbl.kitchenStage === "READY" && (
                            <span style={{ fontSize: "10px", background: "rgba(16, 185, 129, 0.25)", color: "#34d399", border: "1px solid rgba(16, 185, 129, 0.6)", borderRadius: "4px", padding: "1px 6px", fontWeight: 800 }}>
                              🔔 Food Ready
                            </span>
                          )}
                          {tbl.kitchenStage === "QUEUED" && (
                            <span style={{ fontSize: "10px", background: "rgba(14, 165, 233, 0.2)", color: "#38bdf8", border: "1px solid rgba(14, 165, 233, 0.4)", borderRadius: "4px", padding: "1px 6px", fontWeight: 700 }}>
                              🟡 KOT Queued
                            </span>
                          )}
                          {tbl.kitchenStage === "SERVED" && (
                            <span style={{ fontSize: "10px", background: "rgba(99, 102, 241, 0.2)", color: "#a5b4fc", border: "1px solid rgba(99, 102, 241, 0.4)", borderRadius: "4px", padding: "1px 6px", fontWeight: 700 }}>
                              🍽️ Served
                            </span>
                          )}
                        </div>
                      )}

                      <div className="card-bottom-actions">
                        {tbl.kitchenStage === "READY" && (
                          <button
                            type="button"
                            className="btn-card-serve"
                            style={{ background: "#10b981", color: "#fff", border: "none", borderRadius: "4px", padding: "2px 6px", fontSize: "10px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "2px" }}
                            onClick={(e) => handleServeTable(e, tbl)}
                            title="Mark all ready food served to table"
                          >
                            🍽️ Serve
                          </button>
                        )}
                        {(tbl.status === "PAID" || tbl.status === "PRINTED" || tbl.kitchenStage === "SERVED" || tbl.status === "DIRTY") && (
                          <button
                            type="button"
                            className="btn-card-vacant"
                            style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: "4px", padding: "2px 6px", fontSize: "10px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "2px" }}
                            onClick={(e) => handleVacateTable(e, tbl)}
                            title="Clear table and mark vacant for next guests"
                          >
                            🧹 Vacant
                          </button>
                        )}
                        <button
                          type="button"
                          className="card-action-icon"
                          onClick={(e) => handleQuickPrint(e, tbl)}
                          title="Quick Print KOT / Bill"
                        >
                          🖨️
                        </button>
                        <button
                          type="button"
                          className="card-action-icon"
                          onClick={(e) => handleInspect(e, tbl)}
                          title="Preview Table Details"
                        >
                          👁️
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Move KOT Modal */}
      {isMoveKotOpen && (
        <MoveKotModal
          tables={tables}
          onClose={() => setIsMoveKotOpen(false)}
          onSuccess={fetchTablesData}
        />
      )}

      {/* Add Table Modal */}
      {isAddTableOpen && (
        <AddTableModal
          onClose={() => setIsAddTableOpen(false)}
          onTableCreated={fetchTablesData}
        />
      )}

      {/* Table Inspection Modal */}
      {inspectTable && (
        <div className="inspect-backdrop" onClick={() => setInspectTable(null)}>
          <div className="inspect-card" onClick={(e) => e.stopPropagation()}>
            <div className="inspect-header">
              <h3>Table {inspectTable.tableNumber} ({inspectTable.section})</h3>
              <button className="close-btn" onClick={() => setInspectTable(null)}>✕</button>
            </div>

            <div style={{ marginTop: "12px", fontSize: "0.875rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Status: <strong style={{ color: "#2563eb" }}>{inspectTable.status}</strong></span>
                <span>Stage: <strong style={{ color: inspectTable.kitchenStage === "READY" ? "#d97706" : inspectTable.kitchenStage === "SERVED" ? "#059669" : "#64748b" }}>{inspectTable.kitchenStage || "N/A"}</strong></span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
                <span>Capacity: <strong>{inspectTable.capacity} guests</strong></span>
                {inspectTable.elapsedMinutes ? (
                  <span>Seated: <strong>{inspectTable.elapsedMinutes} mins</strong></span>
                ) : null}
              </div>
            </div>

            {/* Granular KOT Waves Breakdown */}
            {inspectTable.currentOrder?.kots && inspectTable.currentOrder.kots.length > 0 ? (
              <div style={{ marginTop: "14px" }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: "0.8125rem", color: "#475569" }}>Kitchen Order Tickets (KOT Waves):</h4>
                <div style={{ maxHeight: "160px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
                  {inspectTable.currentOrder.kots.map((k: any) => (
                    <div key={k.id} style={{ background: "#f8fafc", padding: "6px 8px", borderRadius: "6px", border: "1px solid #e2e8f0", fontSize: "0.75rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginBottom: "3px" }}>
                        <span>KOT #{k.ticketNumber}</span>
                        <span style={{ color: k.status === "SERVED" ? "#059669" : k.status === "READY" ? "#d97706" : "#2563eb" }}>
                          {k.status}
                        </span>
                      </div>
                      {k.items?.map((it: any) => (
                        <div key={it.id} style={{ display: "flex", justifyContent: "space-between", color: "#64748b" }}>
                          <span>{it.quantity}x {it.name}</span>
                          <span>{it.status}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ) : inspectOrderDetails && inspectOrderDetails.items ? (
              <div style={{ marginTop: "16px" }}>
                <h4 style={{ margin: "0 0 8px 0", fontSize: "0.875rem" }}>Active Order Items:</h4>
                <div style={{ maxHeight: "160px", overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: "6px" }}>
                  {inspectOrderDetails.items.map((it: any) => (
                    <div key={it.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", borderBottom: "1px solid #f1f5f9", fontSize: "0.8125rem" }}>
                      <span>{it.quantity}x {it.menuItemName || it.menuItem?.name}</span>
                      <span>₹{(Number(it.subtotalMinor || 0) / 100).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {inspectTable.totalMinor ? (
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "12px", fontWeight: 700, fontSize: "0.95rem" }}>
                <span>Running Total:</span>
                <span style={{ color: "#16a34a" }}>
                  ₹{(Number(inspectTable.totalMinor || 0) / 100).toFixed(2)}
                </span>
              </div>
            ) : null}

            <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginTop: "20px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: "6px" }}>
                {inspectTable.kitchenStage === "READY" && (
                  <button
                    type="button"
                    style={{ background: "#10b981", color: "#fff", border: "none", padding: "6px 12px", borderRadius: "6px", fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}
                    onClick={async (e) => {
                      await handleServeTable(e, inspectTable);
                      setInspectTable(null);
                    }}
                  >
                    🍽️ Mark All Served
                  </button>
                )}
                <button
                  type="button"
                  style={{ background: "#6366f1", color: "#fff", border: "none", padding: "6px 12px", borderRadius: "6px", fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}
                  onClick={async (e) => {
                    await handleVacateTable(e, inspectTable);
                    setInspectTable(null);
                  }}
                >
                  🧹 Mark Vacant
                </button>
              </div>

              <div style={{ display: "flex", gap: "6px" }}>
                <button className="btn-secondary" onClick={() => setInspectTable(null)}>Close</button>
                <button
                  className="btn-primary"
                  onClick={() => {
                    handleTableClick(inspectTable);
                    setInspectTable(null);
                  }}
                >
                  Open in POS Register →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .table-view-container {
          display: flex;
          flex-direction: column;
          height: calc(100vh - 48px);
          background: #f1f5f9;
          font-family: inherit;
        }

        .table-view-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 16px;
          background: #ffffff;
          border-bottom: 1px solid #e2e8f0;
          gap: 12px;
          flex-wrap: wrap;
        }

        .toolbar-left {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .toolbar-title {
          font-size: 0.95rem;
          font-weight: 700;
          color: #334155;
          margin: 0;
        }

        .btn-move-kot {
          background: #eff6ff;
          color: #2563eb;
          border: 1px solid #bfdbfe;
          border-radius: 4px;
          padding: 4px 10px;
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-move-kot:hover {
          background: #dbeafe;
        }

        .status-legend-group {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .legend-pill {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 4px;
          padding: 3px 8px;
          font-size: 0.6875rem;
          color: #475569;
          display: flex;
          align-items: center;
          gap: 4px;
          cursor: pointer;
        }
        .legend-pill.active {
          background: #e2e8f0;
          font-weight: 700;
          color: #0f172a;
        }

        .dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          display: inline-block;
        }
        .dot-blank { background: #cbd5e1; }
        .dot-running { background: #0284c7; }
        .dot-printed { background: #22c55e; }
        .dot-paid { background: #3b82f6; }
        .dot-running-kot { background: #eab308; }

        .toolbar-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .btn-toolbar-icon {
          background: #f8fafc;
          border: 1px solid #cbd5e1;
          border-radius: 4px;
          padding: 4px 8px;
          cursor: pointer;
        }
        .btn-add-table {
          background: #f97316;
          color: #ffffff;
          border: none;
          border-radius: 4px;
          padding: 5px 12px;
          font-size: 0.75rem;
          font-weight: 700;
          cursor: pointer;
        }
        .btn-delivery-jump, .btn-pickup-jump {
          background: #dc2626;
          color: #ffffff;
          border: none;
          border-radius: 4px;
          padding: 5px 12px;
          font-size: 0.75rem;
          font-weight: 700;
          cursor: pointer;
        }

        .floor-matrix-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .floor-section-block {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 14px;
        }
        .section-title-label {
          margin: 0 0 12px 0;
          font-size: 0.8125rem;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .tables-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(105px, 1fr));
          gap: 10px;
        }

        .table-card {
          border-radius: 6px;
          padding: 8px 6px 4px 6px;
          min-height: 80px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          cursor: pointer;
          transition: transform 0.1s, box-shadow 0.1s;
          border: 1px solid transparent;
        }
        .table-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }

        .card-blank {
          background: #e2e8f0;
          color: #475569;
          border-color: #cbd5e1;
        }
        .card-running-kot {
          background: #fef08a; /* Yellow */
          color: #713f12;
          border-color: #facc15;
        }
        .card-printed {
          background: #bbf7d0; /* Green */
          color: #14532d;
          border-color: #86efac;
        }
        .card-paid {
          background: #bfdbfe; /* Blue */
          color: #1e3a8a;
          border-color: #93c5fd;
        }
        .card-running {
          background: #bae6fd; /* Cyan */
          color: #0c4a6e;
          border-color: #7dd3fc;
        }

        .card-top-info {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1px;
        }
        .elapsed-badge {
          font-size: 0.625rem;
          font-weight: 600;
        }
        .table-code-name {
          font-size: 0.875rem;
          font-weight: 800;
        }
        .table-amount {
          font-size: 0.6875rem;
          font-weight: 700;
        }
        .blank-spacer {
          height: 12px;
        }

        .card-bottom-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-top: 4px;
          border-top: 1px solid rgba(0, 0, 0, 0.06);
        }
        .card-action-icon {
          background: transparent;
          border: none;
          padding: 2px 4px;
          cursor: pointer;
          font-size: 0.75rem;
          opacity: 0.7;
        }
        .card-action-icon:hover {
          opacity: 1;
        }

        /* Inspect modal */
        .inspect-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(15, 23, 42, 0.5);
          z-index: 150;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .inspect-card {
          background: #ffffff;
          padding: 20px;
          border-radius: 12px;
          width: 90%;
          max-width: 440px;
        }
        .inspect-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .close-btn {
          background: transparent;
          border: none;
          font-size: 1.1rem;
          cursor: pointer;
        }
        .btn-secondary {
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          padding: 6px 14px;
          border-radius: 6px;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-primary {
          background: #2563eb;
          color: #ffffff;
          border: none;
          padding: 6px 16px;
          border-radius: 6px;
          font-weight: 600;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
