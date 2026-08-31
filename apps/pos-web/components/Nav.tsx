// Shared permission-aware nav for pos-web. Renders only the links whose
// required permission is present in the current user's real GET /auth/me
// permissions array (fetched via fetchMe()/getSession() from lib/auth.ts —
// no hardcoded permission lists per repo CLAUDE.md). Each page previously
// hardcoded its own <nav> with links to every page regardless of what the
// user's role actually granted; a user with only "order.create" would still
// see (and could click into, then get redirected away from) /admin, /kitchen,
// /inventory. This component centralizes that logic so all pages agree.
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { fetchMe, fetchMyOutlets, switchOutlet, logout, MeOutlet, OutletSummary } from "../lib/auth";
import QuickLinks from "./QuickLinks";

interface NavLinkDef {
  href: string;
  permission: string;
  topbarLabel: string;
  pillLabel: string;
}

// Order matches the nav markup that existed inline in each page before this
// component was introduced.
const NAV_LINKS: NavLinkDef[] = [
  { href: "/", permission: "order.create", topbarLabel: "POS Terminal", pillLabel: "🛒 POS Register" },
  { href: "/waiter", permission: "order.create", topbarLabel: "Waiter App", pillLabel: "🏃 Waiter App" },
  { href: "/orders?tab=live", permission: "order.read", topbarLabel: "Live Orders", pillLabel: "🔴 Live Orders" },
  { href: "/orders?tab=all", permission: "order.read", topbarLabel: "All Orders", pillLabel: "📋 All Orders" },
  { href: "/orders?tab=online", permission: "order.read", topbarLabel: "Online Orders", pillLabel: "🌐 Online Orders" },
  { href: "/kitchen", permission: "kot.read", topbarLabel: "KDS Kitchen Board", pillLabel: "🍳 Kitchen KDS" },
  { href: "/inventory", permission: "inventory.read", topbarLabel: "Stock & 86-List", pillLabel: "📦 Stock Control" },
  { href: "/menu", permission: "menu.category.manage", topbarLabel: "Menu Management", pillLabel: "🍽️ Menu Management" },
  { href: "/channel-availability", permission: "integration.manage", topbarLabel: "Online Item Status", pillLabel: "📡 Online Status" },
  { href: "/admin", permission: "report.read", topbarLabel: "Sales Analytics", pillLabel: "📊 Sales Reports" },
  { href: "/finance", permission: "report.read", topbarLabel: "Finance & Z-Report", pillLabel: "💰 Finance" },
  { href: "/crm", permission: "crm.read", topbarLabel: "Customers & Loyalty", pillLabel: "🎁 Customers" },
  { href: "/marketing", permission: "crm.write", topbarLabel: "Marketing Campaigns", pillLabel: "📣 Marketing" },
  { href: "/user-management", permission: "users.manage", topbarLabel: "User & Role Management", pillLabel: "🧑‍💼 Users & Roles" },
];

export type NavVariant = "topbar" | "pill" | "sidebar";

interface SidebarLinkDef {
  href: string;
  permission: string;
  label: string;
}

interface SidebarGroupDef {
  header: string | null; // null => single-link group, rendered directly (no header)
  badge?: string;
  links: SidebarLinkDef[];
}

const SIDEBAR_GROUPS: SidebarGroupDef[] = [
  { header: null, links: [{ href: "/admin", permission: "report.read", label: "Dashboard" }] },
  {
    header: "Daily Operations",
    links: [
      { href: "/", permission: "order.create", label: "POS Terminal" },
      { href: "/waiter", permission: "order.create", label: "Waiter App" },
      { href: "/orders?tab=live", permission: "order.read", label: "Live Orders" },
      { href: "/orders?tab=all", permission: "order.read", label: "All Orders" },
      { href: "/orders?tab=online", permission: "order.read", label: "Online Orders" },
      { href: "/kitchen", permission: "kot.read", label: "KOT" },
    ],
  },
  {
    header: "Menu",
    links: [{ href: "/menu", permission: "menu.category.manage", label: "Menu Management" }],
  },
  { header: null, links: [{ href: "/inventory", permission: "inventory.read", label: "Inventory" }] },
  {
    header: null,
    badge: "New",
    links: [{ href: "/marketing", permission: "crm.write", label: "Marketing Automation" }],
  },
  {
    header: null,
    badge: "New",
    links: [{ href: "/finance", permission: "report.read", label: "Finance" }],
  },
  {
    header: "Reports",
    links: [
      { href: "/admin", permission: "report.read", label: "Sales Analytics" },
      { href: "/waiter-monitor", permission: "report.read", label: "Waiter Floor Monitor" },
      { href: "/kitchen-analytics", permission: "report.read", label: "Kitchen Prep Times" },
    ],
  },
  {
    header: "Management",
    links: [
      { href: "/user-management", permission: "users.manage", label: "User & Role Management" },
      { href: "/table-management", permission: "table.manage", label: "Table Management" },
    ],
  },
  { header: null, links: [{ href: "/crm", permission: "crm.read", label: "CRM" }] },
  {
    header: "Aggregator Center",
    links: [
      { href: "/integrations", permission: "integration.manage", label: "Connect Delivery Apps" },
      { href: "/channel-availability", permission: "integration.manage", label: "Online Item Status" },
    ],
  },
];

interface NavProps {
  variant?: NavVariant;
}

export default function Nav({ variant = "pill" }: NavProps): JSX.Element | null {
  const router = useRouter();
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const [currentOutlet, setCurrentOutlet] = useState<MeOutlet | null>(null);
  const [myOutlets, setMyOutlets] = useState<OutletSummary[]>([]);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((me) => {
      if (cancelled) return;
      setPermissions(me ? me.permissions : []);
      setCurrentOutlet(me ? me.outlet : null);
    }).catch(() => undefined);
    fetchMyOutlets().then((outlets) => {
      if (cancelled) return;
      setMyOutlets(outlets);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOutletChange = async (newOutletId: string) => {
    if (!newOutletId || switching) return;
    setSwitching(true);
    const result = await switchOutlet(newOutletId);
    if (result.ok) {
      window.location.reload();
    } else {
      setSwitching(false);
      alert("Failed to switch outlet. Please try again.");
    }
  };

  const outletSwitcher =
    myOutlets.length > 1 ? (
      <select
        value={currentOutlet?.id || ""}
        disabled={switching}
        onChange={(e) => handleOutletChange(e.target.value)}
        style={{
          cursor: switching ? "wait" : "pointer",
          background: "var(--bg-card, #fff)",
          border: "1px solid var(--border, #e2e8f0)",
          color: "var(--text, #0f172a)",
          fontWeight: 600,
          padding: "10px 12px",
          minHeight: "44px",
          borderRadius: "var(--radius-pill, 9999px)",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {myOutlets.map((outlet) => (
          <option key={outlet.id} value={outlet.id}>
            {outlet.name} ({outlet.code})
          </option>
        ))}
      </select>
    ) : null;

  // Until we know the real permission set, render nothing rather than a
  // flash of links the user may not be allowed to see.
  if (permissions === null) return null;

  const visibleLinks = NAV_LINKS.filter((link) => permissions.includes(link.permission));

  const isActive = (href: string): boolean =>
    href.includes("?") ? router.asPath === href : router.pathname === href;

  const logoutButton = (
    <button
      type="button"
      onClick={() => {
        if (confirm("Are you sure you want to log out?")) {
          logout().catch(() => {});
        }
      }}
      className="logout-btn"
      style={{
        cursor: "pointer",
        background: "rgba(239, 68, 68, 0.08)",
        border: "1px solid rgba(239, 68, 68, 0.2)",
        color: "var(--destructive)",
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "10px 16px",
        minHeight: "44px",
        borderRadius: "var(--radius-pill)",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      Logout 🚪
    </button>
  );

  if (variant === "topbar") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexGrow: 1, justifyContent: "center", minWidth: 0 }}>
        <nav className="topbar-nav" style={{ flexGrow: 1, maxWidth: "75%" }}>
          {visibleLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-pill ${isActive(link.href) ? "active" : ""}`}
            >
              {link.topbarLabel}
            </Link>
          ))}
        </nav>
        {outletSwitcher}
        {logoutButton}
      </div>
    );
  }

  if (variant === "sidebar") {
    return (
      <div className="sidebar-nav" style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column", height: "100%" }}>
        {outletSwitcher && (
          <div style={{ padding: "0 16px 12px" }}>{outletSwitcher}</div>
        )}
        {SIDEBAR_GROUPS.map((group, idx) => {
          const visible = group.links.filter((l) => permissions.includes(l.permission));
          if (visible.length === 0) return null;

          const linkStyle = (active: boolean, bold: boolean): React.CSSProperties => ({
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "10px 16px",
            margin: "2px 8px",
            borderRadius: 10,
            color: active ? "#065f46" : "#0f172a",
            background: active ? "#ecfdf5" : "transparent",
            textDecoration: "none",
            fontSize: "0.88rem",
            fontWeight: bold ? 600 : 500,
          });

          if (group.header === null) {
            const link = visible[0];
            const active = isActive(link.href);
            return (
              <Link key={idx} href={link.href} style={linkStyle(active, true)}>
                <span>{link.label}</span>
                {group.badge && (
                  <span
                    style={{
                      background: "#10b981",
                      color: "#fff",
                      fontSize: "0.65rem",
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: 9999,
                    }}
                  >
                    {group.badge}
                  </span>
                )}
              </Link>
            );
          }

          return (
            <div key={idx} className="sidebar-group">
              <div className="sidebar-group-header">{group.header}</div>
              {visible.map((link) => (
                <Link key={link.href} href={link.href} style={linkStyle(isActive(link.href), false)}>
                  {link.label}
                </Link>
              ))}
            </div>
          );
        })}

        <div className="sidebar-group">
          <div className="sidebar-group-header">Quick Links</div>
          <div style={{ padding: "4px 8px" }}>
            <QuickLinks />
          </div>
        </div>

        <div style={{ marginTop: "auto", padding: "16px" }}>{logoutButton}</div>

        <style jsx>{`
          .sidebar-nav {
            background: var(--bg-card, #fff);
            border-right: 1px solid var(--border, #e2e8f0);
            padding: 16px 0;
            overflow-y: auto;
          }
          .sidebar-group {
            margin-bottom: 8px;
          }
          .sidebar-group-header {
            font-size: 0.72rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--text-muted, #94a3b8);
            padding: 10px 16px 4px;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", flexGrow: 1, justifyContent: "center", minWidth: 0 }}>
      <nav className="nav-pill-group" style={{ flexGrow: 1, maxWidth: "75%" }}>
        {visibleLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`nav-item ${isActive(link.href) ? "active" : ""}`}
          >
            {link.pillLabel}
          </Link>
        ))}
      </nav>
      {outletSwitcher}
      {logoutButton}
    </div>
  );
}
