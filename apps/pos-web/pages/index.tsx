import React, { useState, useEffect } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { useAuthGuard, getSession } from "../lib/auth";
import PetPoojaHeader from "../components/PetPoojaHeader";
import TableViewFloor from "../components/TableViewFloor";
import PosBillingView from "../components/PosBillingView";

export default function POSIndexPage() {
  const { me, loading: authLoading } = useAuthGuard("order.create");
  const router = useRouter();

  const outlet = me?.outlet ?? null;
  const outletName = outlet?.name || (authLoading ? "Loading..." : "Outlet");
  const outletCode = outlet?.code || "";

  // Check router query to see if we should display billing or floor
  const [viewMode, setViewMode] = useState<"FLOOR" | "BILLING">("FLOOR");
  const [selectedTable, setSelectedTable] = useState<string>("B6");
  const [selectedTableId, setSelectedTableId] = useState<string>("");
  const [selectedOrderMode, setSelectedOrderMode] = useState<"DINE_IN" | "DELIVERY" | "PICKUP">("DINE_IN");

  useEffect(() => {
    if (router.query.table) {
      setSelectedTable(String(router.query.table));
      if (router.query.tableId) setSelectedTableId(String(router.query.tableId));
      setViewMode("BILLING");
    } else if (router.query.mode) {
      const mode = String(router.query.mode).toUpperCase();
      if (mode === "DELIVERY" || mode === "PICKUP" || mode === "DINE_IN") {
        setSelectedOrderMode(mode as any);
      }
      setViewMode("BILLING");
    }
  }, [router.query]);

  const handleNewOrder = () => {
    setSelectedTable("Direct");
    setSelectedTableId("");
    setViewMode("BILLING");
  };

  const handleSelectTableFromFloor = (table: any) => {
    setSelectedTable(table.tableNumber);
    setSelectedTableId(table.id);
    setViewMode("BILLING");
  };

  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
        <div style={{ textAlign: "center", color: "#64748b" }}>
          <div style={{ fontSize: "2rem", marginBottom: "8px" }}>⏳</div>
          <div>Loading PetPooja POS Register...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="petpooja-app-root">
      <Head>
        <title>{outletName} - PetPooja POS Management Platform</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </Head>

      {/* Universal Top Header */}
      <PetPoojaHeader
        outletName={outletName}
        outletCode={outletCode}
        onNewOrder={handleNewOrder}
      />

      {/* Main View Area */}
      {viewMode === "FLOOR" ? (
        <TableViewFloor
          onSelectTable={handleSelectTableFromFloor}
          onNavigateDelivery={() => {
            setSelectedOrderMode("DELIVERY");
            setViewMode("BILLING");
          }}
          onNavigatePickup={() => {
            setSelectedOrderMode("PICKUP");
            setViewMode("BILLING");
          }}
        />
      ) : (
        <PosBillingView
          initialTable={selectedTable}
          initialTableId={selectedTableId}
          initialMode={selectedOrderMode}
          resumeHoldId={typeof router.query.resumeHold === "string" ? router.query.resumeHold : ""}
          onBackToTables={() => {
            // #region agent log
            fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'K3',location:'index.tsx:onBackToTables',message:'Done back to floor',data:{hasSession:Boolean(getSession()),path:typeof window!=='undefined'?window.location.pathname:null},timestamp:Date.now(),runId:'cover-0029'})}).catch(()=>{});
            // #endregion
            setViewMode("FLOOR");
            router.push("/", undefined, { shallow: true });
          }}
        />
      )}

      <style jsx global>{`
        body {
          margin: 0;
          padding: 0;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #f8fafc;
          overflow-x: hidden;
        }
        * {
          box-sizing: border-box;
        }
      `}</style>
    </div>
  );
}
