import React, { useState, useEffect, useMemo, useRef } from "react";
import Head from "next/head";
import Link from "next/link";
import { authedFetch, useAuthGuard, logout } from "../lib/auth";
import { useKapmetaSocket } from "../lib/useKapmetaSocket";
import CaptainNavDrawer from "../components/CaptainNavDrawer";
import UnsuccessfulKotModal from "../components/UnsuccessfulKotModal";
import LanServerDiscoveryModal from "../components/LanServerDiscoveryModal";
import CaptainPinLoginModal from "../components/CaptainPinLoginModal";
import WaiterCashTipsCalculator from "../components/WaiterCashTipsCalculator";
import MoveKotModal from "../components/MoveKotModal";
import AttractiveMenuItemCard, { MenuItemData } from "../components/menu/AttractiveMenuItemCard";
import MenuCustomizerModal, { CustomizedItemSelection } from "../components/menu/MenuCustomizerModal";
import { DietaryFilter } from "../components/menu/CategoryNavbar";

interface MenuItem {
  id: string;
  name: string;
  category: string;
  description: string;
  priceMinor: number;
  isVeg: boolean;
  isStocked: boolean;
  stockQty: number;
  icon: string;
}

interface RawMenuItemApi extends Omit<MenuItem, "isStocked" | "stockQty" | "category"> {
  categoryName: string;
  availability: { isStocked: boolean; stockQty: number; version: number } | null;
}

interface DiningTable {
  id: string;
  tableNumber: string;
  capacity: number;
  section: string;
  status: "VACANT" | "OCCUPIED" | "BILLING" | "DIRTY";
  isActive: boolean;
  kitchenStage?: "QUEUED" | "COOKING" | "READY" | "SERVED" | null;
  orderStatus?: string | null;
  currentOrderId?: string | null;
  mergeGroupId?: string | null;
  mergePrimaryTableId?: string | null;
  mergedWith?: string[];
  isMergePrimary?: boolean;
  currentOrder?: {
    id: string;
    kots?: { id: string; ticketNumber: string; status: string }[];
  } | null;
}

type Course = "STARTER" | "MAIN" | "DESSERT" | "BEVERAGE";
const COURSES: Course[] = ["STARTER", "MAIN", "DESSERT", "BEVERAGE"];

interface CartItem {
  item: MenuItem;
  quantity: number;
  notes: string;
  course: Course;
  seatNumber?: number | null;
}

interface KOTTicket {
  id: string;
  ticketNumber: string;
  status: "QUEUED" | "PREPARING" | "READY" | "SERVED";
  createdAt: string;
  tableNumber?: string | null;
  kotItems: {
    id: string;
    quantity: number;
    notes: string | null;
    course: Course | null;
    menuItem: { name: string };
  }[];
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  grandTotalMinor: string;
  items: {
    id: string;
    menuItemId: string;
    menuItemName: string;
    quantity: number;
    unitPriceMinor: string;
    subtotalMinor: string;
    notes: string | null;
    isVoided: boolean;
    course: string | null;
    seatNumber: number | null;
    kitchenStatus?: string | null;
  }[];
}

interface BillData {
  orderId: string;
  orderNumber: string;
  subtotalMinor: string;
  discountTotalMinor: string;
  taxTotalMinor: string;
  tipTotalMinor: string;
  serviceChargeTotalMinor: string;
  grandTotalMinor: string;
  paidMinor: string;
  dueMinor: string;
}

interface SeatBillData {
  seatNumber: number | null;
  subtotalMinor: string;
  paidMinor: string;
}

interface QueuedRequest {
  id: string;
  url: string;
  method: string;
  body: any;
}

function kitchenItemLabel(status?: string | null): string {
  if (status === "SERVED") return "Served";
  if (status === "READY") return "Ready";
  if (status === "PREPARING" || status === "COOKING" || status === "IN_PREPARATION") return "Cooking";
  if (status === "QUEUED" || status === "KOT_CREATED" || status === "PENDING") return "In kitchen";
  return "Ticketed";
}

const OFFLINE_QUEUE_KEY = "kapmeta_waiter_offline_queue";

function loadOfflineQueue(): QueuedRequest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveOfflineQueue(queue: QueuedRequest[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

async function syncOfflineQueue() {
  if (typeof window === "undefined") return;
  const queue = loadOfflineQueue();
  if (queue.length === 0) return;
  const remaining: QueuedRequest[] = [];
  for (const item of queue) {
    try {
      const res = await authedFetch(item.url, {
        method: item.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.body),
      });
      if (!res.ok) remaining.push(item);
    } catch {
      remaining.push(item);
    }
  }
  saveOfflineQueue(remaining);
}

// ----------------------------------------------------
// Web Audio API: Native synthesised bell chime for KOT pickup
// ----------------------------------------------------
function playPickupBeep() {
  if (typeof window === "undefined") return;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    
    // Play a two-tone chime (880Hz -> 1760Hz bell sequence)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, ctx.currentTime); // A5
    osc1.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.15); // A6
    gain1.gain.setValueAtTime(0.4, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.6);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(1320, ctx.currentTime + 0.15); // E6
    gain2.gain.setValueAtTime(0, ctx.currentTime);
    gain2.gain.setValueAtTime(0.3, ctx.currentTime + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(ctx.currentTime + 0.15);
    osc2.stop(ctx.currentTime + 0.7);
  } catch (e) {
    console.error("Failed to play audio alert", e);
  }
}

export default function WaiterDashboard() {
  const { me, loading: authLoading } = useAuthGuard("order.create");

  // Floor Map & Catalog States
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [myKots, setMyKots] = useState<KOTTicket[]>([]);
  const kotFetchGen = useRef(0);
  const [selectedSection, setSelectedSection] = useState<string>("All");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Active Order Building State
  const [activeTable, setActiveTable] = useState<DiningTable | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [coversCount, setCoversCount] = useState<number>(2);
  const [selectedCourse, setSelectedCourse] = useState<Course>("STARTER");
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [dietaryFilter, setDietaryFilter] = useState<DietaryFilter>("ALL");
  const [menuViewMode, setMenuViewMode] = useState<"tile" | "compact">("tile");
  const [customizingItem, setCustomizingItem] = useState<MenuItemData | null>(null);
  const [detailItem, setDetailItem] = useState<MenuItem | null>(null);

  // Manage existing occupied table order (add items / void)
  const [manageOrder, setManageOrder] = useState<OrderDetail | null>(null);
  const [loadingManageOrder, setLoadingManageOrder] = useState(false);
  const manageOrderRef = useRef<OrderDetail | null>(null);
  const activeTableRef = useRef<DiningTable | null>(null);
  manageOrderRef.current = manageOrder;
  activeTableRef.current = activeTable;

  // Table Transfer & Merge states
  const [transferFromTable, setTransferFromTable] = useState<DiningTable | null>(null);
  const [mergeSourceIds, setMergeSourceIds] = useState<string[]>([]);
  const [mergeMode, setMergeMode] = useState(false);
  const [tableActionError, setTableActionError] = useState<string | null>(null);

  // Bill & Pay modal states
  const [billTable, setBillTable] = useState<DiningTable | null>(null);
  const [bill, setBill] = useState<BillData | null>(null);
  const [loadingBill, setLoadingBill] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<string>("CASH");
  const [tipInput, setTipInput] = useState<string>("");
  const [serviceChargeInput, setServiceChargeInput] = useState<string>("");
  const [savingCharges, setSavingCharges] = useState(false);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [seatBills, setSeatBills] = useState<SeatBillData[]>([]);
  const [splitBySeat, setSplitBySeat] = useState(false);

  // Captain Drawer & Modals
  const [isCaptainDrawerOpen, setIsCaptainDrawerOpen] = useState<boolean>(false);
  const [isUnsuccessfulModalOpen, setIsUnsuccessfulModalOpen] = useState<boolean>(false);
  const [isServerIpModalOpen, setIsServerIpModalOpen] = useState<boolean>(false);
  const [isPinLoginModalOpen, setIsPinLoginModalOpen] = useState<boolean>(false);
  const [isCashTipsCalculatorOpen, setIsCashTipsCalculatorOpen] = useState<boolean>(false);

  // Connectivity & Feedback
  const [mounted, setMounted] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [offlineCount, setOfflineCount] = useState<number>(0);
  const [offlineQueue, setOfflineQueue] = useState<QueuedRequest[]>([]);
  const [loadingTables, setLoadingTables] = useState<boolean>(true);
  const [submittingOrder, setSubmittingOrder] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);

  // Waiter Personal Shift Stats
  const [showStats, setShowStats] = useState<boolean>(false);
  const [myStats, setMyStats] = useState<{
    ordersToday: number;
    tablesServed: number;
    completedOrders: number;
    avgOrderMinutes: number | null;
    tipsMinor: string;
    serviceChargeMinor?: string;
    revenueMinor: string;
  } | null>(null);
  const [isMoveKotOpen, setIsMoveKotOpen] = useState(false);

  // Load Tables
  const fetchTables = async () => {
    try {
      const res = await authedFetch("/tables");
      if (res.ok) {
        const data = await res.json();
        const mapped: DiningTable[] = (data || []).map((tbl: any) => {
          const live = !!tbl.currentOrder;
          let status: DiningTable["status"] = "VACANT";
          if (!live) status = "VACANT";
          else if (tbl.status === "PRINTED" || tbl.status === "BILLING" || tbl.status === "PAID") status = "BILLING";
          else status = "OCCUPIED";
          return {
            id: tbl.id,
            tableNumber: tbl.tableNumber,
            capacity: tbl.groupCapacity || tbl.capacity || 4,
            section: tbl.section || "General",
            status,
            isActive: tbl.isActive !== false,
            kitchenStage: tbl.kitchenStage || null,
            orderStatus: tbl.currentOrder?.status || null,
            currentOrderId: tbl.currentOrder?.id || tbl.activeOrderId || null,
            mergeGroupId: tbl.mergeGroupId || null,
            mergePrimaryTableId: tbl.mergePrimaryTableId || null,
            mergedWith: Array.isArray(tbl.mergedWith) ? tbl.mergedWith : [],
            isMergePrimary: !!tbl.isMergePrimary,
            currentOrder: tbl.currentOrder
              ? { id: tbl.currentOrder.id, kots: tbl.currentOrder.kots || [] }
              : null,
          };
        });


        setTables(mapped);
      }
    } catch (e) {
      console.error("Failed to fetch tables", e);
    } finally {
      setLoadingTables(false);
    }
  };

  const fetchMyStats = async () => {
    try {
      const res = await authedFetch("/waiters/me/stats");
      if (res.ok) setMyStats(await res.json());
    } catch {
      // keep last snapshot
    }
  };

  // Load Menu
  const fetchMenu = async () => {
    try {
      const res = await authedFetch("/menu/items");
      if (res.ok) {
        const data = await res.json();
        const rawItems = Array.isArray(data) ? data : data.items || [];
        const mapped: MenuItem[] = rawItems.map((item: any) => ({
          id: item.id,
          name: item.name || "Dish",
          category: item.categoryName || item.category?.name || item.category || "General",
          description: item.description || "",
          priceMinor: Number(item.priceMinor || (Number(item.price || 0) * 100)),
          isVeg: item.isVeg ?? true,
          isStocked: item.isStocked !== undefined ? item.isStocked : (item.isActive ?? true),
          stockQty: item.stockQty ?? 100,
          icon: item.icon || "🍽️",
        }));
        setMenuItems(mapped);
        const cats = Array.from(new Set(mapped.map((item) => item.category).filter(Boolean)));
        setCategories(["All", ...cats]);
      }
    } catch (e) {
      console.error("Failed to fetch menu items", e);
    }
  };

  // Load Waiter Active KOTs
  const fetchKots = async () => {
    const gen = ++kotFetchGen.current;
    try {
      const res = await authedFetch("/kitchen/kot");
      if (!res.ok) return;
      const data = await res.json();
      const rows: KOTTicket[] = Array.isArray(data) ? data : Array.isArray(data?.tickets) ? data.tickets : [];
      const live = rows.filter((k) => k.status === "QUEUED" || k.status === "PREPARING" || k.status === "READY");
      if (gen !== kotFetchGen.current) return;
      setMyKots(live);
    } catch (e) {
      console.error("Failed to fetch KOTs", e);
    }
  };

  const heartbeat = async () => {
    try {
      await authedFetch("/waiters/heartbeat", { method: "POST" });
    } catch {
      // offline — presence just goes stale, nothing to queue
    }
  };

  const flushOfflineQueue = async () => {
    const queue = loadOfflineQueue();
    if (queue.length === 0) return;
    const remaining: QueuedRequest[] = [];
    for (const req of queue) {
      try {
        const res = await authedFetch(req.url, {
          method: req.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body),
        });
        if (!res.ok) remaining.push(req);
      } catch {
        remaining.push(req);
      }
    }
    saveOfflineQueue(remaining);
    setOfflineCount(remaining.length);
    if (remaining.length < queue.length) {
      fetchTables();
      fetchKots();
      showPickupNotification(`Synced ${queue.length - remaining.length} queued order(s)`);
    }
  };

  useEffect(() => {
    setMounted(true);
    setOfflineQueue(loadOfflineQueue());
    if (authLoading) return;
    fetchTables();
    fetchMenu();
    fetchKots();
    heartbeat();
    setOfflineCount(loadOfflineQueue().length);

    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    const goOnline = () => {
      setIsOnline(true);
      flushOfflineQueue();
    };
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    setIsOnline(navigator.onLine);

    const interval = setInterval(() => {
      fetchTables();
      fetchKots();
      heartbeat();
      if (navigator.onLine) flushOfflineQueue();
    }, 15000);

    return () => {
      clearInterval(interval);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [authLoading]);

  const showPickupNotification = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 8000);
  };

  useKapmetaSocket(
    (payload) => {
      const status = payload.data?.status;
      const stage = payload.data?.stage;
      const servedIds = [
        payload.data?.kotTicketId,
        ...((payload.data?.kotTicketIds as string[] | undefined) || []),
      ].filter((id): id is string => typeof id === "string" && id.length > 0);

      if (status === "SERVED" && servedIds.length > 0) {
        setMyKots((prev) => prev.filter((k) => !servedIds.includes(k.id)));
      }

      fetchKots();
      fetchTables();
      fetchMyStats();
      const openOrderId = manageOrderRef.current?.id;
      if (openOrderId) {
        authedFetch(`/orders/${openOrderId}`)
          .then(async (r) => {
            if (r.ok) setManageOrder(await r.json());
          })
          .catch(() => {});
      }
      if (
        (payload.topic === "kot.status_updated" && status === "READY") ||
        (payload.topic === "order.status_updated" && stage === "FOOD_READY")
      ) {
        const ticketId = String(payload.data?.kotTicketId || payload.data?.orderId || "");
        const msg = `Order/Ticket #${ticketId.slice(-4)} is READY at the pickup counter!`;
        showPickupNotification(msg);
        playPickupBeep();
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification("Kitchen: Order Ready", { body: msg, icon: undefined });
        }
      }
    },
    !authLoading,
    "waiter"
  );

  // Unique sections list
  const sections = useMemo(() => {
    const s = Array.from(new Set(tables.map((t) => t.section))).filter(Boolean) as string[];
    return ["All", ...s];
  }, [tables]);

  // Filtered tables
  const filteredTables = useMemo(() => {
    return tables.filter((t) => selectedSection === "All" || t.section === selectedSection);
  }, [tables, selectedSection]);

  // Filtered menu
  const filteredMenu = useMemo(() => {
    return menuItems.filter((item) => {
      const matchCat = selectedCategory === "All" || item.category === selectedCategory;
      const matchSearch =
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.category.toLowerCase().includes(searchQuery.toLowerCase());

      let matchDiet = true;
      if (dietaryFilter === "VEG_ONLY") matchDiet = item.isVeg === true;
      else if (dietaryFilter === "NON_VEG_ONLY") matchDiet = item.isVeg === false;
      else if (dietaryFilter === "BESTSELLERS_ONLY") matchDiet = (item.priceMinor > 8000 && item.priceMinor < 20000);

      return matchCat && matchSearch && matchDiet;
    });
  }, [menuItems, selectedCategory, searchQuery, dietaryFilter]);

  const addCustomizedToCart = (item: MenuItemData, customization: CustomizedItemSelection) => {
    const customizedName = `${item.name} (${customization.portion === "HALF" ? "Half" : customization.portion === "FULL" ? "Full" : "Reg"}${customization.addons.length > 0 ? " + " + customization.addons.map((a) => a.name).join(", ") : ""})`;
    const customItem: MenuItem = {
      id: item.id,
      name: customizedName,
      category: item.category,
      description: item.description || "",
      priceMinor: customization.finalPriceMinor,
      isVeg: item.isVeg,
      isStocked: item.isStocked ?? true,
      stockQty: item.stockQty ?? 100,
      icon: "🍽️",
    };

    setCart((prev) => [
      ...prev,
      {
        item: customItem,
        quantity: 1,
        course: selectedCourse,
        seatNumber: selectedSeat,
        notes: customization.specialInstructions || "",
      },
    ]);
  };

  // Cart operations
  const addToCart = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((ci) => ci.item.id === item.id);
      if (existing) {
        return prev.map((ci) => ci.item.id === item.id ? { ...ci, quantity: ci.quantity + 1 } : ci);
      }
      return [...prev, { item, quantity: 1, notes: "", course: selectedCourse, seatNumber: selectedSeat }];
    });
  };

  const updateItemCourse = (itemId: string, course: Course) => {
    setCart((prev) => prev.map((ci) => (ci.item.id === itemId ? { ...ci, course } : ci)));
  };

  const updateItemSeat = (itemId: string, seatNumber: number | null) => {
    setCart((prev) => prev.map((ci) => (ci.item.id === itemId ? { ...ci, seatNumber } : ci)));
  };

  const updateQuantity = (itemId: string, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((ci) => ci.item.id !== itemId));
    } else {
      setCart((prev) => prev.map((ci) => ci.item.id === itemId ? { ...ci, quantity: qty } : ci));
    }
  };

  const updateItemNotes = (itemId: string, notes: string) => {
    setCart((prev) => prev.map((ci) => ci.item.id === itemId ? { ...ci, notes } : ci));
  };

  const totalAmount = useMemo(() => {
    return cart.reduce((acc, ci) => acc + (ci.item.priceMinor * ci.quantity), 0);
  }, [cart]);

  // Place Table Order — courseFilter fires only that course's cart lines (course-wise firing);
  // omit to fire the whole cart at once.
  const submitOrder = async (courseFilter?: Course) => {
    if (!activeTable) return;
    const firing = courseFilter ? cart.filter((ci) => ci.course === courseFilter) : cart;
    if (firing.length === 0) return;
    setSubmittingOrder(true);
    setOrderError(null);

    const idempotencyKey = `waiter-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const lines = firing.map((ci) => ({
      menuItemId: ci.item.id,
      quantity: ci.quantity,
      modifierOptionIds: [],
      notes: ci.notes || undefined,
      course: ci.course,
      seatNumber: ci.seatNumber ?? undefined,
    }));
    const body = {
      action: "KOT",
      status: "KOT_CREATED",
      terminalNumber: "T-01",
      orderType: "DINE_IN",
      diningTableId: activeTable.mergePrimaryTableId || activeTable.id,
      tableNumber: activeTable.tableNumber,
      waiterId: me?.userId,
      idempotencyKey,
      lines,
    };

    try {
      const existingOrderId = activeTable.currentOrderId;
      const res = existingOrderId
        ? await authedFetch(`/orders/${existingOrderId}/items`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lines }),
          })
        : await authedFetch("/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      if (res.ok) {
        const created = await res.json();
        const orderId = created.id || existingOrderId;
        setCart((prev) => prev.filter((ci) => !firing.includes(ci)));
        if (courseFilter && !manageOrder && orderId) {
          const detailRes = await authedFetch(`/orders/${orderId}`);
          if (detailRes.ok) setManageOrder(await detailRes.json());
        } else if (!courseFilter) {
          setActiveTable(null);
        }
        fetchTables();
        fetchKots();
        showPickupNotification(`KOT sent for Table ${activeTable.tableNumber}.`);
      } else {
        const errData = await res.json().catch(() => ({}));
        setOrderError(errData.error || "Failed to place order");
      }
    } catch (e) {
      // Offline — queue it. idempotencyKey guarantees a later retry can't double-create.
      const queue = loadOfflineQueue();
      queue.push({ id: idempotencyKey, url: "/orders", method: "POST", body });
      saveOfflineQueue(queue);
      setOfflineCount(queue.length);
      setCart((prev) => prev.filter((ci) => !firing.includes(ci)));
      if (!courseFilter) setActiveTable(null);
      showPickupNotification("Offline — order queued, will sync when back online");
    } finally {
      setSubmittingOrder(false);
    }
  };

  // Change Table Status directly
  const updateTableStatus = async (tableId: string, status: "VACANT" | "OCCUPIED" | "BILLING" | "DIRTY") => {
    try {
      const url = status === "VACANT" ? `/tables/${tableId}/vacant` : `/tables/${tableId}/status`;
      const res = await authedFetch(url, {
        method: status === "VACANT" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: status === "VACANT" ? undefined : JSON.stringify({ status }),
      });
      if (res.ok) {
        fetchTables();
      } else {
        const errData = await res.json().catch(() => ({}));
        setTableActionError(errData.error || "Could not update table");
        showPickupNotification(errData.error || "Could not update table");
      }
    } catch (e) {
      console.error("Failed to update table status", e);
    }
  };

  const serveTable = async (table: DiningTable) => {
    try {
      const res = await authedFetch(`/tables/${table.id}/serve`, { method: "POST" });
      if (res.ok) {
        fetchTables();
        fetchKots();
        showPickupNotification(`Table ${table.tableNumber} served — still running until billed`);
        if (activeTableRef.current?.id === table.id) {
          await openManageTable(table);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        showPickupNotification(errData.error || "Serve failed");
      }
    } catch (e) {
      console.error("Failed to serve table", e);
    }
  };

  // Open an OCCUPIED table for management (add items / void / bill) — loads its live order
  const openManageTable = async (table: DiningTable) => {
    setActiveTable(table);
    setCart([]);
    setManageOrder(null);
    setLoadingManageOrder(true);
    try {
      const activeRes = await authedFetch(`/orders/by-table/${table.id}/active`);
      if (!activeRes.ok) {
        setOrderError("No active order found for this table");
        return;
      }
      const { id: orderId } = await activeRes.json();
      const detailRes = await authedFetch(`/orders/${orderId}`);
      if (detailRes.ok) {
        const detail = await detailRes.json();
        setManageOrder(detail);
      }
    } catch (e) {
      console.error("Failed to load table order", e);
    } finally {
      setLoadingManageOrder(false);
    }
  };

  const refreshManageOrder = async () => {
    if (!manageOrder) return;
    const res = await authedFetch(`/orders/${manageOrder.id}`);
    if (res.ok) setManageOrder(await res.json());
  };

  // Send cart items as additional items on an already-fired order (fires its own KOT).
  // courseFilter fires only that course's lines — used for course-wise firing.
  const submitAddItems = async (courseFilter?: Course) => {
    if (!manageOrder) return;
    const firing = courseFilter ? cart.filter((ci) => ci.course === courseFilter) : cart;
    if (firing.length === 0) return;
    setSubmittingOrder(true);
    setOrderError(null);
    const lines = firing.map((ci) => ({
      menuItemId: ci.item.id,
      quantity: ci.quantity,
      modifierOptionIds: [],
      notes: ci.notes || undefined,
      course: ci.course,
      seatNumber: ci.seatNumber ?? undefined,
    }));
    const url = `/orders/${manageOrder.id}/items`;
    try {
      const res = await authedFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines }),
      });
      if (res.ok) {
        setCart((prev) => prev.filter((ci) => !firing.includes(ci)));
        await refreshManageOrder();
        fetchKots();
        showPickupNotification("Items sent to kitchen!");
      } else {
        const errData = await res.json();
        setOrderError(errData.error || "Failed to add items");
      }
    } catch (e) {
      const queue = loadOfflineQueue();
      queue.push({ id: `${manageOrder.id}-${Date.now()}`, url, method: "POST", body: { lines } });
      saveOfflineQueue(queue);
      setOfflineCount(queue.length);
      setCart((prev) => prev.filter((ci) => !firing.includes(ci)));
      showPickupNotification("Offline — items queued, will sync when back online");
    } finally {
      setSubmittingOrder(false);
    }
  };

  const voidItem = async (itemId: string) => {
    const reasonCode = prompt("Reason for voiding this item?");
    if (!reasonCode) return;
    try {
      const res = await authedFetch(`/orders/${manageOrder?.id}/items/${itemId}/void`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasonCode }),
      });
      if (res.ok) {
        await refreshManageOrder();
      } else {
        const errData = await res.json();
        setOrderError(errData.error || "Failed to void item");
      }
    } catch (e) {
      setOrderError("Network error voiding item");
    }
  };

  // Transfer: move active order from one table to a chosen vacant table
  const startTransfer = (table: DiningTable) => {
    setTableActionError(null);
    setTransferFromTable(table);
  };

  const completeTransfer = async (toTableId: string) => {
    if (!transferFromTable) return;
    try {
      const res = await authedFetch(`/tables/${transferFromTable.id}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetTableId: toTableId, toTableId }),
      });
      if (res.ok) {
        setTransferFromTable(null);
        fetchTables();
        showPickupNotification(`Table ${transferFromTable.tableNumber} transferred successfully!`);
      } else {
        const errData = await res.json();
        setTableActionError(errData.error || "Transfer failed");
      }
    } catch (e) {
      setTableActionError("Network error during transfer");
    }
  };

  // Merge: fold selected occupied tables' orders into one target table
  const toggleMergeSource = (tableId: string) => {
    setMergeSourceIds((prev) => (prev.includes(tableId) ? prev.filter((id) => id !== tableId) : [...prev, tableId]));
  };

  const completeMerge = async (targetTableId: string) => {
    if (mergeSourceIds.length === 0) return;
    try {
      const res = await authedFetch("/tables/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceTableIds: mergeSourceIds, targetTableId }),
      });
      if (res.ok) {
        setMergeSourceIds([]);
        setMergeMode(false);
        fetchTables();
        fetchKots();
        showPickupNotification("Tables merged!");
      } else {
        const errData = await res.json();
        setTableActionError(errData.error || "Merge failed");
      }
    } catch (e) {
      setTableActionError("Network error during merge");
    }
  };

  // Bill & payment
  const openBill = async (table: DiningTable) => {
    setBillTable(table);
    setBill(null);
    setSeatBills([]);
    setSplitBySeat(false);
    setTipInput("");
    setServiceChargeInput("");
    setLoadingBill(true);
    try {
      const orderId = table.currentOrderId;
      let resolvedOrderId = orderId || null;
      if (!resolvedOrderId) {
        const activeRes = await authedFetch(`/orders/by-table/${table.id}/active`);
        if (!activeRes.ok) return;
        const { id } = await activeRes.json();
        resolvedOrderId = id;
      }
      const billRes = await authedFetch(`/orders/${resolvedOrderId}/bill`);
      if (billRes.ok) {
        const b = await billRes.json();
        setBill(b);
        setPaymentAmount((Number(b.dueMinor) / 100).toFixed(2));
        setTipInput((Number(b.tipTotalMinor) / 100).toFixed(2));
        setServiceChargeInput((Number(b.serviceChargeTotalMinor) / 100).toFixed(2));
      }
    } catch (e) {
      console.error("Failed to load bill", e);
    } finally {
      setLoadingBill(false);
    }
  };

  const loadSeatBills = async () => {
    if (!bill) return;
    try {
      const res = await authedFetch(`/orders/${bill.orderId}/bill/by-seat`);
      if (res.ok) setSeatBills(await res.json());
    } catch (e) {
      console.error("Failed to load seat bills", e);
    }
  };

  const applyCharges = async (): Promise<boolean> => {
    if (!bill) return false;
    setSavingCharges(true);
    try {
      const tipMinor = Math.round((parseFloat(tipInput) || 0) * 100);
      const serviceChargeMinor = Math.round((parseFloat(serviceChargeInput) || 0) * 100);
      const res = await authedFetch(`/orders/${bill.orderId}/charges`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipMinor, serviceChargeMinor }),
      });
      if (res.ok) {
        const refreshed = await authedFetch(`/orders/${bill.orderId}/bill`);
        if (refreshed.ok) {
          const b = await refreshed.json();
          setBill(b);
          setPaymentAmount((Number(b.dueMinor) / 100).toFixed(2));
        }
        return true;
      }
      return false;
    } catch (e) {
      console.error("Failed to apply charges", e);
      return false;
    } finally {
      setSavingCharges(false);
    }
  };

  const submitPayment = async (overrideAmountMinor?: number, seatNumber?: number) => {
    if (!bill) return;
    setSubmittingPayment(true);
    try {
      await applyCharges();
      const latestBillRes = await authedFetch(`/orders/${bill.orderId}/bill`);
      const latestBill = latestBillRes.ok ? await latestBillRes.json() : bill;
      if (latestBillRes.ok) setBill(latestBill);
      const amountMinor =
        overrideAmountMinor ??
        (Number(latestBill.dueMinor) || Math.round(parseFloat(paymentAmount) * 100));
      const alreadyPaidInFull = Number(latestBill.dueMinor) <= 0;
      if ((!amountMinor || amountMinor <= 0) && !alreadyPaidInFull) {
        setSubmittingPayment(false);
        return;
      }
      if (alreadyPaidInFull && billTable) {
        const settleRes = await authedFetch(`/orders/${bill.orderId}/settle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentMethod }),
        });
        await authedFetch(`/tables/${billTable.id}/vacant`, { method: "POST" }).catch(() => {});
        setBillTable(null);
        fetchTables();
        fetchMyStats();
        showPickupNotification(settleRes.ok ? "Bill settled — table vacant" : "Settle failed");
        setSubmittingPayment(false);
        return;
      }
      const res = await authedFetch(`/orders/${bill.orderId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountMinor, method: paymentMethod, seatNumber }),
      });
      if (res.ok) {
        const refreshed = await authedFetch(`/orders/${bill.orderId}/bill`);
        if (refreshed.ok) {
          const b = await refreshed.json();
          setBill(b);
          if (Number(b.dueMinor) <= 0 && billTable) {
            const settleRes = await authedFetch(`/orders/${bill.orderId}/settle`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paymentMethod }),
            });
            if (!settleRes.ok) {
              const errData = await settleRes.json().catch(() => ({}));
              showPickupNotification(errData.error || "Paid, but settle failed");
            }
            const vacantRes = await authedFetch(`/tables/${billTable.id}/vacant`, { method: "POST" }).catch(() => null);
            setBillTable(null);
            fetchTables();
            fetchMyStats();
            showPickupNotification("Bill settled — table vacant");
          }
        }
        if (splitBySeat) await loadSeatBills();
        showPickupNotification("Payment recorded!");
      }
    } catch (e) {
      console.error("Payment failed", e);
    } finally {
      setSubmittingPayment(false);
    }
  };

  // Serve KOT (Waiter food delivery)
  const serveKot = async (ticketId: string) => {
    try {
      const res = await authedFetch(`/kitchen/kot/${ticketId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStatus: "SERVED" }),
      });
      if (res.ok) {
        fetchKots();
        fetchTables();
        const openOrderId = manageOrderRef.current?.id;
        if (openOrderId) {
          const detailRes = await authedFetch(`/orders/${openOrderId}`);
          if (detailRes.ok) setManageOrder(await detailRes.json());
        }
      }
    } catch (e) {
      console.error("Failed to serve KOT", e);
    }
  };

  if (!mounted || authLoading || loadingTables) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mx-auto mb-4"></div>
          <p className="text-slate-400">Loading floor map...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Head>
        <title>Captain - {me?.outlet?.name || "Waiter"}</title>
      </Head>

      <div className="flex-1 flex flex-col min-w-0">

      {/* PetPooja Captain Mobile / Tablet Topbar */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsCaptainDrawerOpen(true)}
            className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700"
            title="Open Captain Menu"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-blue-400 text-xs tracking-wider">PETPOOJA CAPTAIN</span>
              <span className="text-[10px] bg-amber-500/20 text-amber-400 font-bold px-1.5 py-0.5 rounded">cp4</span>
            </div>
            <div className="text-[11px] text-slate-400 font-medium">{me?.outlet?.name || "Hotel kapila"}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-slate-400 text-xs">
          <button
            type="button"
            onClick={() => setIsCashTipsCalculatorOpen(true)}
            className="flex items-center gap-1.5 bg-emerald-950/40 text-emerald-400 border border-emerald-500/30 px-3 py-1 rounded-lg text-[11px] font-bold hover:bg-emerald-900/50"
            title="Shift Cash & Tips Reconciliation"
          >
            💰 Cash & Tips
          </button>

          <button
            type="button"
            onClick={() => setIsPinLoginModalOpen(true)}
            className="flex items-center gap-1.5 bg-slate-800 text-slate-200 hover:text-white px-2.5 py-1 rounded-lg text-[11px] font-bold"
            title="Fast PIN Switch Staff"
          >
            🧑‍🍳 PIN
          </button>

          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-1 bg-rose-950/40 text-rose-400 hover:text-white hover:bg-rose-900/60 border border-rose-500/30 px-2.5 py-1 rounded-lg text-[11px] font-bold transition"
            title="Log Out & End Shift"
          >
            🚪 Logout
          </button>

          {offlineCount > 0 ? (
            <button
              type="button"
              onClick={() => setIsUnsuccessfulModalOpen(true)}
              className="flex items-center gap-1 text-rose-400 bg-rose-950/40 border border-rose-500/30 px-2 py-0.5 rounded-full text-[10px] font-bold"
            >
              ⚠️ {offlineCount}
            </button>
          ) : (
            <span className="flex items-center gap-1 text-emerald-400 text-[10px] font-bold">
              ● Sync
            </span>
          )}
          <span title="Wi-Fi Signal Strong">📶</span>
          <span title="Battery Level">🔋 66%</span>
        </div>
      </div>

      {/* Real-time alert banner */}
      {toastMessage && (
        <div className="fixed top-20 right-4 z-50 bg-indigo-600 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 animate-bounce border border-indigo-400 max-w-sm">
          <span className="text-2xl">🍳</span>
          <div>
            <p className="font-semibold text-sm">Kitchen Announcement</p>
            <p className="text-xs text-indigo-100 mt-0.5">{toastMessage}</p>
          </div>
          <button onClick={() => setToastMessage(null)} className="ml-auto text-indigo-200 hover:text-white text-lg">×</button>
        </div>
      )}

      <main className="flex-1 p-4 lg:p-6 max-w-7xl mx-auto w-full">
        {/* Dedicated Full-Screen Order Taking Canvas when a table is selected */}
        {activeTable ? (
          <div className="w-full flex flex-col gap-4 animate-fade-in">
            {/* Top Bar: Table Info, Covers, and Actions */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-xl">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (cart.length > 0 && !confirm("Discard unsent items in the cart?")) return;
                    setActiveTable(null);
                    setManageOrder(null);
                    setCart([]);
                  }}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition"
                >
                  ← Back to Floor
                </button>

                <div className="flex items-center gap-2">
                  <span className="text-xl font-extrabold text-white">
                    Table {activeTable.tableNumber}
                  </span>
                  <span className="text-xs bg-indigo-950 text-indigo-300 border border-indigo-500/30 px-2.5 py-0.5 rounded-full font-bold">
                    {activeTable.section}
                  </span>
                  {manageOrder ? (
                    <span className={`text-xs border px-2.5 py-0.5 rounded-full font-bold ${
                      manageOrder.items.filter((i) => !i.isVoided).every((i) => i.kitchenStatus === "SERVED")
                        ? "bg-emerald-950 text-emerald-300 border-emerald-500/30"
                        : "bg-amber-950 text-amber-300 border-amber-500/30"
                    }`}>
                      {manageOrder.items.filter((i) => !i.isVoided).every((i) => i.kitchenStatus === "SERVED")
                        ? `Running — Served · #${manageOrder.orderNumber}`
                        : `Order #${manageOrder.orderNumber}`}
                    </span>
                  ) : (
                    <span className="text-xs bg-emerald-950 text-emerald-300 border border-emerald-500/30 px-2.5 py-0.5 rounded-full font-bold">
                      New Order
                    </span>
                  )}
                </div>
              </div>

              {/* Middle: Covers / Guests Counter & View Switcher */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-xl">
                  <span className="text-[11px] text-slate-400 font-semibold">Guests / Covers:</span>
                  <button
                    type="button"
                    onClick={() => setCoversCount((c) => Math.max(1, c - 1))}
                    className="w-6 h-6 rounded-lg bg-slate-800 text-slate-200 font-bold flex items-center justify-center hover:bg-slate-700 active:scale-90"
                  >
                    −
                  </button>
                  <span className="text-xs font-extrabold text-indigo-400 min-w-[20px] text-center">{coversCount}</span>
                  <button
                    type="button"
                    onClick={() => setCoversCount((c) => c + 1)}
                    className="w-6 h-6 rounded-lg bg-slate-800 text-slate-200 font-bold flex items-center justify-center hover:bg-slate-700 active:scale-90"
                  >
                    +
                  </button>
                  <span className="text-[11px] text-slate-400">Pax</span>
                </div>

                <div className="flex items-center bg-slate-950 border border-slate-800 p-1 rounded-xl gap-1">
                  <button
                    type="button"
                    onClick={() => setMenuViewMode("tile")}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                      menuViewMode === "tile" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    🖼️ Tiles
                  </button>
                  <button
                    type="button"
                    onClick={() => setMenuViewMode("compact")}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                      menuViewMode === "compact" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    📋 List
                  </button>
                </div>
              </div>
            </div>

            {/* 2-Column Ordering Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left 8 Cols: Search, Filters, Categories & Food Photos Grid */}
              <div className="lg:col-span-8 flex flex-col gap-3">
                {/* Search & Filter Toolbar */}
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl flex flex-col gap-3 shadow-lg">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-2.5 text-slate-400">🔍</span>
                      <input
                        type="text"
                        placeholder="Search dish by name, category, or code..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery("")}
                          className="absolute right-3 top-2 text-slate-400 hover:text-slate-200 text-sm"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Dietary Filter Pills */}
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                      <button
                        type="button"
                        onClick={() => setDietaryFilter("ALL")}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition ${
                          dietaryFilter === "ALL" ? "bg-slate-100 text-slate-900" : "bg-slate-950 text-slate-400 border border-slate-800 hover:text-slate-200"
                        }`}
                      >
                        All ({menuItems.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setDietaryFilter("VEG_ONLY")}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition ${
                          dietaryFilter === "VEG_ONLY" ? "bg-emerald-600 text-white" : "bg-slate-950 text-emerald-400 border border-emerald-500/20"
                        }`}
                      >
                        🟢 Pure Veg
                      </button>
                      <button
                        type="button"
                        onClick={() => setDietaryFilter("NON_VEG_ONLY")}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition ${
                          dietaryFilter === "NON_VEG_ONLY" ? "bg-rose-600 text-white" : "bg-slate-950 text-rose-400 border border-rose-500/20"
                        }`}
                      >
                        🔴 Non-Veg
                      </button>
                      <button
                        type="button"
                        onClick={() => setDietaryFilter("BESTSELLERS_ONLY")}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition ${
                          dietaryFilter === "BESTSELLERS_ONLY" ? "bg-amber-600 text-white" : "bg-slate-950 text-amber-400 border border-amber-500/20"
                        }`}
                      >
                        ⭐ Bestsellers
                      </button>
                    </div>
                  </div>

                  {/* Categories Row */}
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    <button
                      onClick={() => setSelectedCategory("All")}
                      className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                        selectedCategory === "All" ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30" : "bg-slate-950 text-slate-400 border border-slate-800 hover:text-white"
                      }`}
                    >
                      🍽️ All Categories
                    </button>
                    {categories.map((c) => (
                      <button
                        key={c}
                        onClick={() => setSelectedCategory(c)}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                          selectedCategory === c ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30" : "bg-slate-950 text-slate-400 border border-slate-800 hover:text-white"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>

                  {/* Target Course Selector */}
                  <div className="flex items-center gap-2 bg-slate-950/80 p-2 rounded-xl border border-slate-800/80">
                    <span className="text-xs text-slate-400 font-bold px-1">Adding items as Course:</span>
                    <div className="flex gap-1.5 overflow-x-auto">
                      {COURSES.map((c) => (
                        <button
                          key={c}
                          onClick={() => setSelectedCourse(c)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                            selectedCourse === c ? "bg-indigo-600 text-white" : "bg-slate-900 text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* High-Resolution Dishes Photo Grid (Clear & Visible) */}
                <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 min-h-[580px] max-h-[calc(100vh-280px)] overflow-y-auto shadow-inner">
                  {filteredMenu.length === 0 ? (
                    <div className="text-center py-20 text-slate-500 text-sm">
                      No dishes found matching the current filters.
                    </div>
                  ) : (
                    <div className={menuViewMode === "tile" ? "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3.5" : "grid grid-cols-1 sm:grid-cols-2 gap-2.5"}>
                      {filteredMenu.map((item) => {
                        const cartItem = cart.find((ci) => ci.item.id === item.id);
                        const cartQty = cartItem ? cartItem.quantity : 0;

                        return (
                          <AttractiveMenuItemCard
                            key={item.id}
                            item={{
                              ...item,
                              isBestseller: item.priceMinor > 8000 && item.priceMinor < 20000,
                            }}
                            cartQuantity={cartQty}
                            onAdd={() => addToCart(item)}
                            onIncrement={() => updateQuantity(item.id, cartQty + 1)}
                            onDecrement={() => updateQuantity(item.id, cartQty - 1)}
                            onCustomize={(it) => setCustomizingItem(it)}
                            viewMode={menuViewMode}
                            compact={menuViewMode === "compact"}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Right 4 Cols: Live Cart Ticket & Actions */}
              <div className="lg:col-span-4 flex flex-col gap-4 sticky top-4">
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl flex flex-col gap-4">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                    <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                      <span>🛒 Order Ticket</span>
                      <span className="text-xs bg-indigo-950 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full font-bold">
                        {cart.reduce((s, i) => s + i.quantity, 0)} items
                      </span>
                    </h3>
                    {cart.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setCart([])}
                        className="text-xs text-rose-400 hover:text-rose-300 font-semibold"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {/* Fired items if managing */}
                  {manageOrder && manageOrder.items.filter((i) => !i.isVoided).length > 0 && (
                    <div className="border border-slate-800/80 rounded-xl p-3 bg-slate-950/60 max-h-36 overflow-y-auto">
                      <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">
                        {manageOrder.items.filter((i) => !i.isVoided).every((i) => i.kitchenStatus === "SERVED")
                          ? "Served — table still running"
                          : "Fired tickets"}
                      </div>
                      {manageOrder.items.filter((i) => !i.isVoided).map((i) => (
                        <div key={i.id} className="flex justify-between items-center text-xs text-slate-300 py-1 border-b border-slate-900 last:border-0">
                          <span>
                            {i.menuItemName} <b className="text-indigo-400">x{i.quantity}</b>
                            <span className={`ml-2 text-[10px] font-bold ${
                              i.kitchenStatus === "SERVED" ? "text-emerald-400" :
                              i.kitchenStatus === "READY" ? "text-amber-400" :
                              i.kitchenStatus === "PREPARING" ? "text-indigo-400" : "text-slate-500"
                            }`}>
                              {kitchenItemLabel(i.kitchenStatus)}
                            </span>
                          </span>
                          <button
                            onClick={() => voidItem(i.id)}
                            className="text-[10px] text-rose-400 hover:text-rose-300 font-semibold"
                          >
                            Void
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Unsent Cart Items List */}
                  <div className="flex flex-col gap-2.5 max-h-[380px] overflow-y-auto min-h-[140px] pr-1">
                    {cart.length === 0 ? (
                      <div className="text-center py-10 text-slate-500 text-xs flex flex-col items-center gap-2">
                        <span className="text-2xl">🍽️</span>
                        <span>Tap any dish tile to add to order</span>
                      </div>
                    ) : (
                      cart.map((ci) => (
                        <div key={ci.item.id} className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 flex flex-col gap-2 shadow-sm">
                          <div className="flex justify-between items-start">
                            <div>
                              <span className="font-bold text-xs text-white block">{ci.item.name}</span>
                              <span className="text-[11px] text-slate-400">₹{(Number(ci.item.priceMinor) / 100).toFixed(2)} each</span>
                            </div>
                            <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-800">
                              <button
                                onClick={() => updateQuantity(ci.item.id, ci.quantity - 1)}
                                className="text-slate-300 hover:text-white font-bold w-6 h-6 flex items-center justify-center rounded hover:bg-slate-800"
                              >
                                −
                              </button>
                              <span className="text-xs font-extrabold text-indigo-400 min-w-[16px] text-center">{ci.quantity}</span>
                              <button
                                onClick={() => updateQuantity(ci.item.id, ci.quantity + 1)}
                                className="text-slate-300 hover:text-white font-bold w-6 h-6 flex items-center justify-center rounded hover:bg-slate-800"
                              >
                                +
                              </button>
                            </div>
                          </div>

                          {/* Course & Seat Tag */}
                          <div className="flex items-center gap-2">
                            <select
                              value={ci.course}
                              onChange={(e) => updateItemCourse(ci.item.id, e.target.value as Course)}
                              className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-[10px] text-slate-300 font-bold"
                            >
                              {COURSES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min={1}
                              placeholder="Seat #"
                              value={ci.seatNumber ?? ""}
                              onChange={(e) => updateItemSeat(ci.item.id, e.target.value ? parseInt(e.target.value, 10) : null)}
                              className="w-16 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-[10px] text-slate-300 font-semibold"
                            />
                          </div>

                          {/* Special Instructions */}
                          <input
                            type="text"
                            placeholder="Chef notes (e.g. less oil, extra crisp)..."
                            value={ci.notes}
                            onChange={(e) => updateItemNotes(ci.item.id, e.target.value)}
                            className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[10px] text-slate-300 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                      ))
                    )}
                  </div>

                  {orderError && <div className="text-rose-400 text-xs text-center bg-rose-950/40 p-2 rounded-lg border border-rose-500/20">{orderError}</div>}

                  {/* Order Bill Summary */}
                  <div className="border-t border-slate-800 pt-3 flex flex-col gap-1.5">
                    <div className="flex justify-between items-center text-xs text-slate-400">
                      <span>Subtotal:</span>
                      <span>₹{(totalAmount / 100).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm font-bold text-white">
                      <span>Total Amount:</span>
                      <span className="text-lg text-emerald-400 font-extrabold">₹{(totalAmount / 100).toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Fire KOT CTA Buttons */}
                  {COURSES.filter((c) => cart.some((ci) => ci.course === c)).map((c) => (
                    <button
                      key={c}
                      onClick={() => (manageOrder ? submitAddItems(c) : submitOrder(c))}
                      disabled={submittingOrder}
                      className="w-full bg-emerald-800 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl py-2 text-xs font-bold transition-all"
                    >
                      Fire {c} Only ({cart.filter((ci) => ci.course === c).length})
                    </button>
                  ))}

                  <button
                    onClick={() => (manageOrder ? submitAddItems() : submitOrder())}
                    disabled={submittingOrder || cart.length === 0}
                    className="send-to-kitchen w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold text-sm py-3.5 rounded-xl shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 active:scale-[0.98] transition"
                  >
                    {submittingOrder ? "Sending..." : manageOrder ? "Send All Added Items to Kitchen" : "🚀 Send Everything to Kitchen (KOT)"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Floor Map & Live Kitchen Pickups 3-Column Layout */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left 2 Columns: Tables Floor View */}
            <div className="lg:col-span-2 flex flex-col gap-6">
              <div className="bg-slate-900/60 backdrop-blur-md p-5 rounded-2xl border border-slate-800 shadow-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <div>
                    <h1 className="text-xl font-bold tracking-tight">Floor Map</h1>
                    <p className="text-xs text-slate-400 mt-1">Tap a table to log an order or manage table state</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        setMergeMode((v) => !v);
                        setMergeSourceIds([]);
                        setTransferFromTable(null);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                        mergeMode ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300 hover:text-slate-100"
                      }`}
                    >
                      {mergeMode ? "Cancel Merge" : "Merge Tables"}
                    </button>
                    <button
                      onClick={() => setIsMoveKotOpen(true)}
                      className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-slate-800 text-slate-300 hover:text-slate-100"
                    >
                      Move KOT
                    </button>
                    {offlineCount > 0 && (
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-950/40 text-amber-400 border border-amber-500/20">
                        {offlineCount} queued
                      </span>
                    )}
                    <button
                      onClick={async () => {
                        setShowStats(true);
                        await fetchMyStats();
                      }}
                      className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-slate-800 text-slate-300 hover:text-slate-100"
                    >
                      My Stats
                    </button>
                    <Link href="/waiter-monitor" className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-slate-800 text-slate-300 hover:text-slate-100">
                      Floor Monitor
                    </Link>
                    <div className="text-xs text-slate-400">
                      Logged in as: <span className="font-medium text-slate-200">{me?.name}</span>
                    </div>
                  </div>
                </div>

                {transferFromTable && (
                  <div className="mb-4 bg-indigo-950/40 border border-indigo-500/30 rounded-xl p-3 flex items-center justify-between text-xs text-indigo-200">
                    <span>Moving Table {transferFromTable.tableNumber} — tap a vacant table to drop it there.</span>
                    <button onClick={() => setTransferFromTable(null)} className="text-indigo-300 hover:text-white font-bold">Cancel</button>
                  </div>
                )}
                {tableActionError && (
                  <div className="mb-4 bg-rose-950/40 border border-rose-500/30 rounded-xl p-3 text-xs text-rose-300">{tableActionError}</div>
                )}

                {/* Section tabs */}
                <div className="flex gap-2 overflow-x-auto pb-2 border-b border-slate-800 mb-6">
                  {sections.map((section) => (
                    <button
                      key={section}
                      onClick={() => setSelectedSection(section)}
                      className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-200 ${
                        selectedSection === section
                          ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                          : "bg-slate-800 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {section}
                    </button>
                  ))}
                </div>

                {/* Tables Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {filteredTables.map((table) => {
                    let statusColor = "border-emerald-500/20 bg-emerald-950/20 text-emerald-400";
                    let badgeLabel = "Vacant";

                    if (table.status === "BILLING") {
                      statusColor = "border-blue-500/20 bg-blue-950/20 text-blue-400";
                      badgeLabel = "Billing";
                    } else if (table.status === "DIRTY") {
                      statusColor = "border-amber-500/20 bg-amber-950/20 text-amber-400";
                      badgeLabel = "Dirty";
                    } else if (table.status === "OCCUPIED" && table.kitchenStage === "READY") {
                      statusColor = "border-amber-500/30 bg-amber-950/30 text-amber-300";
                      badgeLabel = "Ready";
                    } else if (table.status === "OCCUPIED" && table.kitchenStage === "SERVED") {
                      statusColor = "border-emerald-500/30 bg-emerald-950/30 text-emerald-300";
                      badgeLabel = "Served · Running";
                    } else if (table.status === "OCCUPIED" && (table.kitchenStage === "QUEUED" || table.kitchenStage === "COOKING")) {
                      statusColor = "border-rose-500/20 bg-rose-950/20 text-rose-400";
                      badgeLabel = table.kitchenStage === "COOKING" ? "Cooking" : "In kitchen";
                    } else if (table.status === "OCCUPIED") {
                      statusColor = "border-rose-500/20 bg-rose-950/20 text-rose-400";
                      badgeLabel = "Running";
                    }

                    const isMergeSelected = mergeSourceIds.includes(table.id);

                    return (
                      <div
                        key={table.id}
                        data-table-id={table.tableNumber}
                        data-status={table.status}
                        data-table-uuid={table.id}
                        onClick={() => {
                          if (mergeMode) toggleMergeSource(table.id);
                        }}
                        className={`border rounded-2xl p-4 flex flex-col justify-between h-auto min-h-36 transition-all duration-300 relative overflow-hidden group ${statusColor} ${
                          isMergeSelected ? "ring-2 ring-indigo-400" : ""
                        }`}
                      >
                        <div>
                          <div className="flex justify-between items-start">
                            <span className="text-xl font-bold tracking-tight text-slate-100">{table.tableNumber}</span>
                            <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-slate-950/40 border border-slate-800/40">
                              {badgeLabel}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-400 mt-1 block">Capacity: {table.capacity} Pax</span>
                          {table.mergedWith && table.mergedWith.length > 1 && (
                            <span className="text-[10px] text-indigo-300 mt-0.5 block font-medium">
                              Merged {table.mergedWith.join(" + ")}
                            </span>
                          )}
                        </div>

                        {mergeMode ? (
                          <div className="mt-auto pt-3 z-10 flex flex-col gap-1">
                            <span className="text-[10px] text-center text-indigo-300 font-medium">
                              {isMergeSelected ? "✓ Selected (Source)" : "Tap to select / target"}
                            </span>
                            {mergeSourceIds.length > 0 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  completeMerge(table.id);
                                }}
                                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-1.5 text-[11px] font-bold transition-all shadow-md"
                              >
                                Merge into Table {table.tableNumber}
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1.5 mt-auto pt-3 z-10">
                            {table.status === "VACANT" && transferFromTable && (
                              <button
                                onClick={() => completeTransfer(table.id)}
                                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-1.5 text-xs font-semibold transition-all"
                              >
                                Move {transferFromTable.tableNumber} Here
                              </button>
                            )}
                            {table.status === "VACANT" && !transferFromTable && (
                              <button
                                onClick={() => {
                                  setActiveTable(table);
                                  setCoversCount(table.capacity || 2);
                                  setManageOrder(null);
                                  setCart([]);
                                }}
                                className="new-order-btn w-full bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg py-1.5 text-xs font-semibold transition-all"
                              >
                                + New Order
                              </button>
                            )}
                            {table.status === "OCCUPIED" && (
                              <>
                                {table.kitchenStage === "READY" && (
                                  <button
                                    onClick={() => serveTable(table)}
                                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg py-1.5 text-xs font-semibold transition-all"
                                  >
                                    Serve
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    setCoversCount(table.capacity || 2);
                                    openManageTable(table);
                                  }}
                                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-1.5 text-xs font-semibold transition-all"
                                >
                                  {table.kitchenStage === "SERVED" ? "Add next / Running" : "Manage Order"}
                                </button>
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => startTransfer(table)}
                                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg py-1.5 text-[10px] font-semibold transition-all"
                                  >
                                    Transfer
                                  </button>
                                  <button
                                    onClick={() => openBill(table)}
                                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg py-1.5 text-[10px] font-semibold transition-all"
                                  >
                                    Bill
                                  </button>
                                  <button
                                    onClick={() => updateTableStatus(table.id, "VACANT")}
                                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg py-1.5 text-[10px] font-semibold transition-all"
                                  >
                                    Vacate
                                  </button>
                                </div>
                              </>
                            )}
                            {table.status === "BILLING" && (
                              <button
                                onClick={() => openBill(table)}
                                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-1.5 text-xs font-semibold transition-all"
                              >
                                Pay & Vacate
                              </button>
                            )}
                            {table.status === "DIRTY" && (
                              <button
                                onClick={() => updateTableStatus(table.id, "VACANT")}
                                className="w-full bg-amber-600 hover:bg-amber-500 text-white rounded-lg py-1.5 text-xs font-semibold transition-all"
                              >
                                Mark Clean
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right Column: Live Kitchen Outputs Monitor */}
            <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 shadow-xl flex flex-col h-[650px]">
              <div className="mb-4">
                <h2 className="font-bold text-lg text-slate-100">Live Kitchen Outputs</h2>
                <p className="text-xs text-slate-400">Track ready dishes and deliver to tables</p>
              </div>

              <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-3">
                {myKots.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
                    <span className="text-3xl mb-2">🍽️</span>
                    <p className="text-xs">No active food tickets</p>
                    <p className="text-[10px] text-slate-600 mt-1">New KOTs will update here in real-time</p>
                  </div>
                ) : (
                  myKots.map((kot) => {
                    let badgeColor = "bg-amber-950 text-amber-400 border border-amber-500/20";
                    let isReady = false;

                    if (kot.status === "READY") {
                      badgeColor = "bg-emerald-950 text-emerald-400 border border-emerald-500/20 animate-pulse";
                      isReady = true;
                    } else if (kot.status === "PREPARING") {
                      badgeColor = "bg-indigo-950 text-indigo-400 border border-indigo-500/20";
                    }

                    return (
                      <div
                        key={kot.id}
                        className={`bg-slate-950 border rounded-xl p-4 flex flex-col justify-between transition-all duration-300 ${
                          isReady ? "border-emerald-500/30 shadow-md shadow-emerald-500/5" : "border-slate-800/80"
                        }`}
                      >
                        <div>
                          <div className="flex justify-between items-center mb-3">
                            <span className="font-bold text-xs text-slate-100">
                              KOT #{kot.ticketNumber}{kot.tableNumber ? ` · ${kot.tableNumber}` : ""}
                            </span>
                            <span className={`text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full ${badgeColor}`}>
                              {kot.status}
                            </span>
                          </div>

                          <div className="flex flex-col gap-1.5 pl-1">
                            {kot.kotItems.map((item) => (
                              <div key={item.id} className="flex justify-between text-xs text-slate-300">
                                <span>{item.menuItem.name}</span>
                                <span className="font-bold text-indigo-400">x{item.quantity}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {isReady && (
                          <button
                            onClick={() => serveKot(kot.id)}
                            className="mt-4 w-full bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg py-2 text-xs font-semibold transition-all shadow-md shadow-emerald-600/10"
                          >
                            Serve to Table
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {detailItem && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setDetailItem(null)}>
          <div
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-3">
              <div className="flex items-center gap-2">
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${detailItem.isVeg ? "bg-emerald-950 text-emerald-400 border border-emerald-500/20" : "bg-red-950 text-red-400 border border-red-500/20"}`}>
                  {detailItem.isVeg ? "VEG" : "NON-VEG"}
                </span>
                <h2 className="font-bold text-base text-slate-100">{detailItem.name}</h2>
              </div>
              <button onClick={() => setDetailItem(null)} className="text-slate-400 hover:text-slate-200 text-xl font-bold w-9 h-9 flex items-center justify-center">×</button>
            </div>

            {detailItem.description && (
              <p className="text-xs text-slate-400 leading-relaxed mb-4">{detailItem.description}</p>
            )}

            <div className="flex items-center justify-between mb-5">
              <span className="text-lg font-bold text-slate-100">₹{(detailItem.priceMinor / 100).toFixed(2)}</span>
              {detailItem.isStocked ? (
                <span className="text-[10px] text-emerald-400 font-semibold">{detailItem.stockQty} in stock</span>
              ) : (
                <span className="text-[10px] text-rose-400 font-semibold">86'd — unavailable</span>
              )}
            </div>

            <button
              onClick={() => {
                if (detailItem.isStocked) {
                  addToCart(detailItem);
                  setDetailItem(null);
                }
              }}
              disabled={!detailItem.isStocked}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-xl py-3 text-xs font-bold transition-all"
            >
              {detailItem.isStocked ? `Add to Cart — ${selectedCourse}` : "Unavailable"}
            </button>
          </div>
        </div>
      )}

      {isMoveKotOpen && (
        <MoveKotModal
          tables={tables.map((t) => ({
            id: t.id,
            tableNumber: t.tableNumber,
            section: t.section,
            status: t.status,
            currentOrder: t.currentOrder || null,
          }))}
          onClose={() => setIsMoveKotOpen(false)}
          onSuccess={() => {
            fetchTables();
            fetchKots();
            fetchMyStats();
          }}
        />
      )}

      {showStats && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowStats(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-bold text-lg text-slate-100">My Shift — Today</h2>
              <button onClick={() => setShowStats(false)} className="text-slate-400 hover:text-slate-200 text-xl font-bold w-9 h-9 flex items-center justify-center">×</button>
            </div>

            {!myStats ? (
              <p className="text-xs text-slate-500">Loading...</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-950 rounded-xl p-3">
                  <div className="text-2xl font-bold text-slate-100">{myStats.ordersToday}</div>
                  <div className="text-[10px] text-slate-500 mt-1">Orders Taken</div>
                </div>
                <div className="bg-slate-950 rounded-xl p-3">
                  <div className="text-2xl font-bold text-slate-100">{myStats.tablesServed}</div>
                  <div className="text-[10px] text-slate-500 mt-1">Tables Served</div>
                </div>
                <div className="bg-slate-950 rounded-xl p-3">
                  <div className="text-2xl font-bold text-slate-100">{myStats.avgOrderMinutes ?? "—"}</div>
                  <div className="text-[10px] text-slate-500 mt-1">Avg Order Time (min)</div>
                </div>
                <div className="bg-slate-950 rounded-xl p-3">
                  <div className="text-2xl font-bold text-emerald-400">₹{(Number(myStats.tipsMinor) / 100).toFixed(2)}</div>
                  <div className="text-[10px] text-slate-500 mt-1">Tips Earned</div>
                </div>
                <div className="bg-slate-950 rounded-xl p-3">
                  <div className="text-2xl font-bold text-slate-100">₹{(Number(myStats.serviceChargeMinor || 0) / 100).toFixed(2)}</div>
                  <div className="text-[10px] text-slate-500 mt-1">Service Charge</div>
                </div>
                <div className="bg-slate-950 rounded-xl p-3">
                  <div className="text-2xl font-bold text-slate-100">{myStats.completedOrders}</div>
                  <div className="text-[10px] text-slate-500 mt-1">Settled Orders</div>
                </div>
                <div className="bg-slate-950 rounded-xl p-3 col-span-2">
                  <div className="text-2xl font-bold text-slate-100">₹{(Number(myStats.revenueMinor) / 100).toFixed(2)}</div>
                  <div className="text-[10px] text-slate-500 mt-1">Total Revenue Handled</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {billTable && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-bold text-lg text-slate-100">Bill — Table {billTable.tableNumber}</h2>
              <button onClick={() => setBillTable(null)} className="text-slate-400 hover:text-slate-200 text-xl font-bold">×</button>
            </div>

            {loadingBill && <p className="text-xs text-slate-500 py-4 text-center">Loading live bill details...</p>}

            {!loadingBill && !bill && (
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-5 text-center flex flex-col items-center gap-3">
                <span className="text-3xl">🧾</span>
                <p className="text-xs text-slate-400">No active running order or pending bill for Table {billTable.tableNumber}.</p>
                <button
                  onClick={() => {
                    const tbl = billTable;
                    setBillTable(null);
                    openManageTable(tbl);
                  }}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 text-xs font-semibold transition-all"
                >
                  Manage / Create Order
                </button>
              </div>
            )}

            {bill && (
              <div className="flex flex-col gap-3">
                <div className="text-xs text-slate-400 flex flex-col gap-1.5 border-b border-slate-800 pb-3">
                  <div className="flex justify-between"><span>Subtotal</span><span>₹{(Number(bill.subtotalMinor) / 100).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span>Discount</span><span>-₹{(Number(bill.discountTotalMinor) / 100).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span>Tax</span><span>₹{(Number(bill.taxTotalMinor) / 100).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span>Tip</span><span>₹{(Number(bill.tipTotalMinor) / 100).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span>Service Charge</span><span>₹{(Number(bill.serviceChargeTotalMinor) / 100).toFixed(2)}</span></div>
                  <div className="flex justify-between text-slate-200 font-bold text-sm"><span>Grand Total</span><span>₹{(Number(bill.grandTotalMinor) / 100).toFixed(2)}</span></div>
                  <div className="flex justify-between text-emerald-400"><span>Paid</span><span>₹{(Number(bill.paidMinor) / 100).toFixed(2)}</span></div>
                  <div className="flex justify-between text-rose-400 font-bold"><span>Due</span><span>₹{(Number(bill.dueMinor) / 100).toFixed(2)}</span></div>
                </div>

                <div className="flex gap-1.5 items-end border-b border-slate-800 pb-3">
                  <div className="flex-1">
                    <label className="text-[10px] text-slate-500">Tip (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={tipInput}
                      onChange={(e) => setTipInput(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-slate-500">Service Chg (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={serviceChargeInput}
                      onChange={(e) => setServiceChargeInput(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={applyCharges}
                    disabled={savingCharges}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg px-3 py-1.5 text-[10px] font-bold"
                  >
                    {savingCharges ? "..." : "Apply"}
                  </button>
                </div>

                <button
                  onClick={() => {
                    const next = !splitBySeat;
                    setSplitBySeat(next);
                    if (next) loadSeatBills();
                  }}
                  className={`text-[10px] font-bold rounded-lg py-1.5 ${splitBySeat ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400"}`}
                >
                  {splitBySeat ? "Hide Split by Seat" : "Split Bill by Seat"}
                </button>

                {splitBySeat && (
                  <div className="flex flex-col gap-1.5 border-b border-slate-800 pb-3">
                    {seatBills.length === 0 ? (
                      <p className="text-[10px] text-slate-500 text-center">No seat numbers tagged on this order's items yet</p>
                    ) : (
                      seatBills.map((s) => {
                        const due = Number(s.subtotalMinor) - Number(s.paidMinor);
                        return (
                          <div key={s.seatNumber ?? "none"} className="flex justify-between items-center text-xs bg-slate-950 rounded-lg px-3 py-2">
                            <span className="text-slate-300">{s.seatNumber ? `Seat ${s.seatNumber}` : "Unassigned"}</span>
                            <span className="text-slate-400">₹{(Number(s.subtotalMinor) / 100).toFixed(2)}</span>
                            {due > 0 ? (
                              <button
                                onClick={() => submitPayment(due, s.seatNumber ?? undefined)}
                                disabled={submittingPayment}
                                className="text-[10px] bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg px-2 py-1 font-bold"
                              >
                                Pay ₹{(due / 100).toFixed(2)}
                              </button>
                            ) : (
                              <span className="text-[10px] text-emerald-400 font-bold">Paid</span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {Number(bill.dueMinor) > 0 ? (
                  <>
                    <div className="flex gap-1.5">
                      {(["CASH", "CARD", "UPI"] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => setPaymentMethod(m)}
                          className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                            paymentMethod === m ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      onClick={() => submitPayment()}
                      disabled={submittingPayment}
                      className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white rounded-xl py-3 text-xs font-bold transition-all"
                    >
                      {submittingPayment ? "Processing..." : "Take Payment (Full Order)"}
                    </button>
                  </>
                ) : (
                  <p className="text-center text-emerald-400 text-xs font-semibold py-2">Fully Paid — table cleared</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Slide-out Captain Navigation Drawer */}
      <CaptainNavDrawer
        isOpen={isCaptainDrawerOpen}
        onClose={() => setIsCaptainDrawerOpen(false)}
        outletName={me?.outlet?.name || "Main Outlet"}
        stationCode="cp4"
        staffName={me?.name || "Captain"}
        unsuccessfulCount={offlineCount}
        onNewKot={() => {
          setSelectedSection("All");
          setActiveTable(null);
          showPickupNotification("Select a vacant table to log a new KOT.");
        }}
        onOpenUnsuccessfulModal={() => setIsUnsuccessfulModalOpen(true)}
        onOpenCashTipsCalculator={() => setIsCashTipsCalculatorOpen(true)}
        onSyncData={async () => {
          await fetchTables();
          await fetchMenu();
          await fetchKots();
          await flushOfflineQueue();
          showPickupNotification("✅ Tables, menu catalog, and KOT data synchronized!");
        }}
        onUpdateMenu={async () => {
          await fetchMenu();
          showPickupNotification("🍴 Menu catalog updated to latest version!");
        }}
        onOpenServerIpModal={() => setIsServerIpModalOpen(true)}
        onOpenSettings={() => {
          showPickupNotification("⚙️ Captain Station: cp4 | Mode: High-Reliability Local LAN");
        }}
        onLogout={logout}
      />

      {/* Unsuccessful KOT Sync Modal */}
      {isUnsuccessfulModalOpen && (
        <UnsuccessfulKotModal
          queuedKots={offlineQueue.map((q) => ({
            id: q.id,
            tableNumber: q.url.split("/")[2] || "Table",
            itemCount: q.body?.lines?.length || 1,
            createdAt: new Date().toISOString(),
            errorMessage: "Offline LAN Sync Pending",
          }))}
          onClose={() => setIsUnsuccessfulModalOpen(false)}
          onRetryAll={async () => {
            await syncOfflineQueue();
            setIsUnsuccessfulModalOpen(false);
          }}
          onClearAll={() => {
            saveOfflineQueue([]);
            setOfflineCount(0);
            setIsUnsuccessfulModalOpen(false);
          }}
        />
      )}

      {/* LAN Server IP Configuration Modal */}
      {isServerIpModalOpen && (
        <LanServerDiscoveryModal
          onClose={() => setIsServerIpModalOpen(false)}
          onServerConfigured={(ip) => {
            alert(`Configured Local POS Server Endpoint: ${ip}`);
          }}
        />
      )}

      {/* Shift Cash & Tips Reconciliation Calculator */}
      <WaiterCashTipsCalculator
        isOpen={isCashTipsCalculatorOpen}
        onClose={() => setIsCashTipsCalculatorOpen(false)}
      />

      {/* Fast Staff PIN Login Modal */}
      <CaptainPinLoginModal
        isOpen={isPinLoginModalOpen}
        onClose={() => setIsPinLoginModalOpen(false)}
        onSuccess={(user) => {
          alert(`Welcome back, ${user.name}! Shift active.`);
          window.location.reload();
        }}
      />

      {/* Item Customizer Modal */}
      <MenuCustomizerModal
        isOpen={!!customizingItem}
        item={customizingItem}
        onClose={() => setCustomizingItem(null)}
        onConfirm={(item, custom) => {
          addCustomizedToCart(item, custom);
          setCustomizingItem(null);
        }}
      />

      </div>
    </div>
  );
}
