import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { authedFetch, fetchMe } from "../lib/auth";
import { extractInclusiveTaxMinor } from "../lib/inclusive-tax";
import {
  existingOrResolvedCustomerId,
  fetchCustomerGuestFields,
  guestPhoneForForm,
} from "../lib/resolve-customer";
import { useKapmetaSocket } from "../lib/useKapmetaSocket";
import { channelPausedMessage, opsStatusFromPayload, type OutletOpsStatus } from "../lib/channel-ops";
import BillSplitModal from "./BillSplitModal";
import AttractiveMenuItemCard, { MenuItemData } from "./menu/AttractiveMenuItemCard";
import MenuCustomizerModal, { CustomizedItemSelection } from "./menu/MenuCustomizerModal";
import CategoryNavbar, { DietaryFilter } from "./menu/CategoryNavbar";

interface MenuItem {
  id: string;
  name: string;
  category: string;
  description?: string;
  priceMinor: number;
  isVeg: boolean;
  isStocked: boolean;
  stockQty: number;
  hasModifiers?: boolean;
  taxRate: number;
}

interface CartItem {
  cartItemId: string;
  item: MenuItem;
  quantity: number;
  itemTotalMinor: number;
  notes?: string;
  checked?: boolean;
  modifierOptionIds?: string[];
}

interface RunningOrderItem {
  id: string;
  menuItemName: string;
  quantity: number;
  unitPriceMinor: number;
  subtotalMinor: number;
  status?: string;
  notes?: string;
}

interface PosBillingViewProps {
  initialTable?: string;
  initialTableId?: string;
  initialMode?: "DINE_IN" | "DELIVERY" | "PICKUP";
  resumeHoldId?: string;
  onBackToTables?: () => void;
}

export default function PosBillingView({
  initialTable = "B6",
  initialTableId = "",
  initialMode = "DINE_IN",
  resumeHoldId = "",
  onBackToTables,
}: PosBillingViewProps) {
  const router = useRouter();
  const [orderMode, setOrderMode] = useState<"DINE_IN" | "DELIVERY" | "PICKUP">(initialMode);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [dietaryFilter, setDietaryFilter] = useState<DietaryFilter>("ALL");
  const [customizingItem, setCustomizingItem] = useState<MenuItemData | null>(null);
  const [catalog, setCatalog] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Cart & Table Metadata
  const [tableNumber, setTableNumber] = useState(initialTable);
  const [tableSection, setTableSection] = useState("Non AC");
  const [coversCount, setCoversCount] = useState(2);
  const [waiterName, setWaiterName] = useState("Captain 1");
  const [cart, setCart] = useState<CartItem[]>([]);

  // Active Running Order from Table & Multi-KOT Waves
  const [activeOrder, setActiveOrder] = useState<any | null>(null);
  const [runningItems, setRunningItems] = useState<RunningOrderItem[]>([]);
  const [tableKots, setTableKots] = useState<Array<{
    id: string;
    ticketNumber: string;
    status: string;
    createdAt: string;
    items: Array<{ id: string; name: string; quantity: number; status: string }>;
  }>>([]);

  // Payment & Settlement
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "CARD" | "DUE" | "OTHER">("CASH");
  const [isPaidChecked, setIsPaidChecked] = useState(false);
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);
  const [processingOrder, setProcessingOrder] = useState(false);
  const [guestPhone, setGuestPhone] = useState("");
  const [guestName, setGuestName] = useState("");
  const [channelOps, setChannelOps] = useState<OutletOpsStatus | null>(null);
  const offFloor = orderMode === "DELIVERY" || orderMode === "PICKUP";
  const modePausedReason = channelPausedMessage(channelOps, orderMode);
  const [scheduleFireAt, setScheduleFireAt] = useState("");
  const orderTableBinding = () =>
    offFloor
      ? { tableNumber: orderMode === "DELIVERY" ? "DELIVERY" : "PICKUP", diningTableId: undefined as string | undefined }
      : { tableNumber, diningTableId: initialTableId || undefined };
  const [outletProfile, setOutletProfile] = useState<{
    name: string;
    address: string | null;
    taxNumber: string | null;
  } | null>(null);

  // Modals & Feedback
  const [receiptModal, setReceiptModal] = useState<any | null>(null);
  const [kotFeedback, setKotFeedback] = useState<{ orderNumber: string; items: string[]; deferredUntil?: string | null } | null>(null);

  // Load Menu & Running Table Order
  useEffect(() => {
    loadMenu();
    loadChannelOps();
    if (orderMode === "DINE_IN") {
      loadActiveTableOrder();
    } else {
      setActiveOrder(null);
      setRunningItems([]);
      setTableKots([]);
    }
    fetchMe().then((me) => {
      if (me?.outlet) {
        setOutletProfile({
          name: me.outlet.name,
          address: me.outlet.address,
          taxNumber: me.outlet.taxNumber,
        });
      }
    }).catch(() => undefined);
  }, [initialTableId, initialTable, resumeHoldId, orderMode]);

  const loadChannelOps = async () => {
    try {
      const res = await authedFetch("/settings/store-status");
      if (!res.ok) return;
      const data = await res.json();
      setChannelOps(opsStatusFromPayload(data));
    } catch {
      /* keep last known flags */
    }
  };

  useKapmetaSocket(
    (payload) => {
      if (payload.topic === "outlet.store_status_updated") {
        setChannelOps(opsStatusFromPayload(payload.data));
        // #region agent log
        fetch("http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"9c675b"},body:JSON.stringify({sessionId:"9c675b",hypothesisId:"CH5",location:"PosBillingView.tsx:socket",message:"store status socket applied",data:{deliveryActive:payload.data?.deliveryActive,pickupActive:payload.data?.pickupActive,isOnline:payload.data?.isOnline},timestamp:Date.now(),runId:"channel-pause"})}).catch(()=>{});
        // #endregion
        return;
      }
      if (orderMode === "DINE_IN" && (initialTableId || initialTable)) loadActiveTableOrder();
    },
    true,
    "pos-billing"
  );

  const loadMenu = async () => {
    try {
      setLoading(true);
      const res = await authedFetch("/menu/availability");
      if (res.ok) {
        const data = await res.json();
        const items: MenuItem[] = (data || []).map((it: any) => ({
          id: it.menuItemId || it.id,
          name: it.name,
          category: it.categoryName || it.category?.name || "General",
          description: it.description || "",
          priceMinor: Number(it.priceMinor || 0),
          isVeg: it.isVeg ?? true,
          isStocked: typeof it.isStocked === "boolean" ? it.isStocked : (it.availability ? it.availability.isStocked : true),
          stockQty: typeof it.stockQty === "number" ? it.stockQty : (it.availability ? it.availability.stockQty : 100),
          taxRate: Number(it.taxRate || 0),
        }));

        setCatalog(items);

        const cats = Array.from(new Set(items.map((i) => i.category))).filter(Boolean);
        setCategories(["All", ...cats]);
        if (cats.length > 0) {
          setSelectedCategory("All");
        }
      }
    } catch (err) {
      console.error("Failed to load catalog", err);
    } finally {
      setLoading(false);
    }
  };

  const applyOrderToBilling = (ord: any) => {
    setActiveOrder(ord);
    if (ord.items && Array.isArray(ord.items)) {
      setRunningItems(
        ord.items.map((it: any) => ({
          id: it.id,
          menuItemName: it.menuItemName || it.item_name || it.name,
          quantity: it.quantity,
          unitPriceMinor: Number(it.unitPriceMinor || it.unitPrice || 0),
          subtotalMinor: Number(it.subtotalMinor || it.subtotal || (it.quantity * it.unitPriceMinor) || 0),
          status: it.status || (ord.advanceStatus === "HELD" ? "HELD" : "KOT_SENT"),
          notes: it.notes,
        }))
      );
    }
    void hydrateGuestFromOrder(ord);
  };

  const hydrateGuestFromOrder = async (ord: any) => {
    const hasCustomerId = Boolean(ord?.customerId);
    let name = String(ord?.customerName || "").trim();
    let phone = guestPhoneForForm(ord?.customerPhone);
    if (hasCustomerId && !name) {
      const fields = await fetchCustomerGuestFields(ord.customerId);
      if (fields) {
        name = fields.name || name;
        phone = fields.phone || phone;
      }
    }
    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'G1',location:'PosBillingView.tsx:hydrateGuestFromOrder',message:'hydrate guest from running order',data:{hasCustomerId,hydratedName:Boolean(name),hydratedPhone:Boolean(phone)},timestamp:Date.now(),runId:'guest-hydrate'})}).catch(()=>{});
    // #endregion
    if (name) setGuestName(name);
    if (phone) setGuestPhone(phone);
  };

  const loadHeldOrder = async (orderId: string) => {
    const ordRes = await authedFetch(`/orders/${orderId}`);
    if (!ordRes.ok) return;
    const ord = await ordRes.json();
    applyOrderToBilling(ord);
    if (ord.tableNumber || ord.table_number) {
      setTableNumber(String(ord.tableNumber || ord.table_number));
    }
  };

  const loadActiveTableOrder = async () => {
    if (resumeHoldId) {
      await loadHeldOrder(resumeHoldId);
      return;
    }
    if (!initialTableId && !initialTable) return;
    try {
      const res = await authedFetch("/tables");
      if (res.ok) {
        const allTables = await res.json();
        const matched = allTables.find((t: any) => t.id === initialTableId || t.tableNumber === initialTable);
        if (matched) {
          setTableNumber(matched.tableNumber);
          setTableSection(matched.section || "Main Dining");
          
          if (matched.activeOrderId) {
            const ordRes = await authedFetch(`/orders/${matched.activeOrderId}`);
            if (ordRes.ok) {
              applyOrderToBilling(await ordRes.json());
            }

            // Also load KOT tickets for granular multi-wave display
            if (matched.currentOrder?.kots) {
              setTableKots(matched.currentOrder.kots);
            } else {
              const kotRes = await authedFetch(`/kitchen/kot`);
              if (kotRes.ok) {
                const allKots = await kotRes.json();
                const matchedKots = (allKots || []).filter((k: any) => k.orderId === matched.activeOrderId);
                setTableKots(
                  matchedKots.map((k: any) => ({
                    id: k.id,
                    ticketNumber: k.ticketNumber,
                    status: k.status,
                    createdAt: k.createdAt,
                    items: (k.kotItems || []).map((ki: any) => ({
                      id: ki.id,
                      name: ki.menuItem?.name || "Item",
                      quantity: ki.quantity,
                      status: ki.servedAt ? "SERVED" : k.status,
                    })),
                  }))
                );
              }
            }
          } else {
            const byTable = await authedFetch(`/orders/by-table/${matched.id}/active`);
            if (byTable.ok) {
              const live = await byTable.json();
              const ordRes = await authedFetch(`/orders/${live.id}`);
              if (ordRes.ok) {
                applyOrderToBilling(await ordRes.json());
              }
            } else {
              setActiveOrder(null);
              setRunningItems([]);
              setTableKots([]);
            }
          }
        }
      }
    } catch (err) {
      console.error("Failed to load active table order", err);
    }
  };

  const handleServeKot = async (kotId: string) => {
    try {
      const res = await authedFetch(`/kitchen/kot/${kotId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ toStatus: "SERVED" }),
      });
      if (res.ok) {
        setTableKots((prev) =>
          prev.map((k) =>
            k.id === kotId
              ? {
                  ...k,
                  status: "SERVED",
                  items: k.items.map((it) => ({ ...it, status: "SERVED" })),
                }
              : k
          )
        );
        await loadActiveTableOrder();
      }
    } catch (e) {
      console.error("Failed to serve KOT", e);
    }
  };

  const handleVacateTable = async () => {
    if (!initialTableId) return;
    try {
      const res = await authedFetch(`/tables/${initialTableId}/vacant`, {
        method: "POST",
      });
      if (res.ok) {
        alert(`Table ${tableNumber} is now marked VACANT and available for new guests.`);
        if (onBackToTables) onBackToTables();
        else router.push("/");
      }
    } catch (e) {
      console.error("Failed to vacate table", e);
    }
  };

  const addToCart = (item: MenuItem) => {
    if (!item.isStocked) {
      alert(`${item.name} is currently 86'd (Out of stock).`);
      return;
    }

    setCart((prev) => {
      const existingIndex = prev.findIndex((c) => c.item.id === item.id);
      if (existingIndex > -1) {
        const updated = [...prev];
        const nextQty = updated[existingIndex].quantity + 1;
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: nextQty,
          itemTotalMinor: nextQty * item.priceMinor,
        };
        return updated;
      }
      return [
        ...prev,
        {
          cartItemId: `item_${Date.now()}_${Math.random()}`,
          item,
          quantity: 1,
          itemTotalMinor: item.priceMinor,
          checked: true,
        },
      ];
    });
  };

  const updateCartItemQty = (cartItemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.cartItemId === cartItemId) {
            const nextQty = c.quantity + delta;
            if (nextQty <= 0) return null;
            return {
              ...c,
              quantity: nextQty,
              itemTotalMinor: nextQty * c.item.priceMinor,
            };
          }
          return c;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const toggleCheckItem = (cartItemId: string) => {
    setCart((prev) =>
      prev.map((c) => (c.cartItemId === cartItemId ? { ...c, checked: !c.checked } : c))
    );
  };

  // Grand Totals Calculation (Running KOT Items + Draft Cart Items)
  const runningSubtotalMinor = useMemo(
    () => runningItems.reduce((sum, it) => sum + it.subtotalMinor, 0),
    [runningItems]
  );
  const cartSubtotalMinor = useMemo(
    () => cart.reduce((sum, it) => sum + it.itemTotalMinor, 0),
    [cart]
  );
  const totalSubtotalMinor = runningSubtotalMinor + cartSubtotalMinor;
  const taxMinor = useMemo(() => {
    const cartTax = cart.reduce(
      (sum, c) => sum + extractInclusiveTaxMinor(c.itemTotalMinor, c.item.taxRate),
      0
    );
    const runningTax = runningItems.reduce((sum, r) => {
      const cat = catalog.find((i) => i.name === r.menuItemName);
      return sum + extractInclusiveTaxMinor(r.subtotalMinor, cat?.taxRate ?? 0);
    }, 0);
    return cartTax + runningTax;
  }, [cart, runningItems, catalog]);
  const grandTotalMinor = totalSubtotalMinor;
  const displayTaxRate = useMemo(() => {
    const rates = [
      ...cart.map((c) => c.item.taxRate),
      ...runningItems.map((r) => catalog.find((i) => i.name === r.menuItemName)?.taxRate ?? 0),
    ].filter((r) => r > 0);
    if (rates.length === 0) return 0;
    const first = rates[0];
    return rates.every((r) => r === first) ? first : 0;
  }, [cart, runningItems, catalog]);

  const cartLines = () =>
    cart.map((c) => ({
      menuItemId: c.item.id,
      quantity: c.quantity,
      unitPriceMinor: c.item.priceMinor,
      notes: c.notes || undefined,
      modifierOptionIds: c.modifierOptionIds || [],
    }));

  const handleHoldCart = async () => {
    if (modePausedReason) {
      alert(modePausedReason);
      return;
    }
    if (cart.length === 0) {
      alert("Add items to the cart before holding. Kitchen tickets on a running table stay on the table.");
      return;
    }
    setProcessingOrder(true);
    try {
      const payload = {
        action: "HOLD",
        orderType: orderMode,
        ...orderTableBinding(),
        customerId: await existingOrResolvedCustomerId({ existingId: activeOrder?.customerId, phone: guestPhone, name: guestName }),
        lines: cartLines(),
      };
      const res = await authedFetch("/orders", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Failed to hold order");
      }
      setCart([]);
      alert(`Order for Table ${tableNumber} is parked. Resume it from Hold in the header.`);
    } catch (e: any) {
      alert(e.message || "Failed to hold order");
    } finally {
      setProcessingOrder(false);
    }
  };

  const handleKotAndPrint = async () => {
    if (modePausedReason) {
      alert(modePausedReason);
      return;
    }
    const parked = activeOrder && (activeOrder.advanceStatus === "HELD" || activeOrder.status === "DRAFT" || activeOrder.status === "PLACED");
    if (cart.length === 0) {
      if (parked && activeOrder?.id) {
        setProcessingOrder(true);
        try {
          const fireRes = await authedFetch(`/orders/${activeOrder.id}/fire-advance`, { method: "POST" });
          if (!fireRes.ok) {
            const errJson = await fireRes.json().catch(() => ({}));
            throw new Error(errJson.error || "Failed to send held order to kitchen");
          }
          setKotFeedback({
            orderNumber: activeOrder.orderNumber || "KOT",
            items: runningItems.map((r) => `${r.quantity}x ${r.menuItemName}`),
          });
          await loadActiveTableOrder();
        } catch (err: any) {
          alert(err.message || "Failed to create KOT");
        } finally {
          setProcessingOrder(false);
        }
        return;
      }
      if (runningItems.length > 0) {
        setKotFeedback({
          orderNumber: activeOrder?.orderNumber || "KOT",
          items: runningItems.map((r) => `${r.quantity}x ${r.menuItemName}`),
        });
        return;
      }
      alert("Please select items from the menu grid to create a KOT ticket.");
      return;
    }
    setProcessingOrder(true);
    try {
      const dispatchedList = cart.map((c) => `${c.quantity}x ${c.item.name}`);
      let orderNum = "KOT-NEW";

      if (activeOrder?.id) {
        const res = await authedFetch(`/orders/${activeOrder.id}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines: cartLines() }),
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || "Failed to add items to active order");
        }
        if (parked) {
          const fireRes = await authedFetch(`/orders/${activeOrder.id}/fire-advance`, { method: "POST" });
          if (!fireRes.ok) {
            const errJson = await fireRes.json().catch(() => ({}));
            throw new Error(errJson.error || "Failed to send held order to kitchen");
          }
        }
        orderNum = activeOrder.orderNumber;
      } else {
        const payload = {
          action: "KOT",
          orderType: orderMode,
          ...orderTableBinding(),
          covers: coversCount,
          waiterName,
          customerId: await existingOrResolvedCustomerId({ existingId: activeOrder?.customerId, phone: guestPhone, name: guestName }),
          lines: cartLines(),
          status: "KOT_CREATED",
          ...(scheduleFireAt
            ? {
                scheduledFireAt: new Date(scheduleFireAt).toISOString(),
                promisedAt: new Date(scheduleFireAt).toISOString(),
              }
            : {}),
        };

        const res = await authedFetch("/orders", {
          method: "POST",
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || "Failed to send KOT");
        }

        const resData = await res.json();
        orderNum = resData.orderNumber || "KOT-NEW";
      }

      setKotFeedback({
        orderNumber: orderNum,
        items: dispatchedList,
        deferredUntil: scheduleFireAt ? new Date(scheduleFireAt).toISOString() : null,
      });
      // #region agent log
      fetch("http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "9c675b" },
        body: JSON.stringify({
          sessionId: "9c675b",
          hypothesisId: "ADV1",
          location: "PosBillingView.tsx:handleKotAndPrint",
          message: "KOT feedback after create",
          data: { orderNum, deferred: Boolean(scheduleFireAt), orderMode },
          timestamp: Date.now(),
          runId: "agg-post",
        }),
      }).catch(() => {});
      // #endregion

      setCart([]);
      await loadActiveTableOrder();
    } catch (err: any) {
      alert(err.message || "Failed to create KOT");
    } finally {
      setProcessingOrder(false);
    }
  };

  const handlePrintAndEBill = async () => {
    if (modePausedReason) {
      alert(modePausedReason);
      return;
    }
    if (cart.length === 0 && runningItems.length === 0) {
      alert("Please select items or open a running table to print bill.");
      return;
    }
    setProcessingOrder(true);
    try {
      // #region agent log
      fetch("http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"9c675b"},body:JSON.stringify({sessionId:"9c675b",hypothesisId:"DUE1",location:"PosBillingView.tsx:handlePrintAndEBill",message:"print bill settle gate",data:{isPaidChecked,paymentMethod,hasActiveOrder:Boolean(activeOrder?.id),orderId:activeOrder?.id||null,cartLen:cart.length,runningLen:runningItems.length},timestamp:Date.now(),runId:"due-print"})}).catch(()=>{});
      // #endregion
      const allDisplayItems = [
        ...runningItems.map((r) => ({ name: r.menuItemName, qty: r.quantity, price: r.subtotalMinor })),
        ...cart.map((c) => ({ name: c.item.name, qty: c.quantity, price: c.itemTotalMinor })),
      ];

      let orderNumber = activeOrder?.orderNumber || "BILL";
      const customerId = await existingOrResolvedCustomerId({
        existingId: activeOrder?.customerId,
        phone: guestPhone,
        name: guestName,
      });
      const settleNow = isPaidChecked;
      // #region agent log
      fetch("http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"9c675b"},body:JSON.stringify({sessionId:"9c675b",hypothesisId:"DUE1",location:"PosBillingView.tsx:handlePrintAndEBill",message:"print settle branch",data:{settleNow,isPaidChecked,paymentMethod,hasActiveOrder:Boolean(activeOrder?.id),orderId:activeOrder?.id||null},timestamp:Date.now(),runId:"due-print-post"})}).catch(()=>{});
      // #endregion

      if (!settleNow) {
        let printOrderId = activeOrder?.id || null;
        if (cart.length > 0) {
          if (activeOrder?.id) {
            const addRes = await authedFetch(`/orders/${activeOrder.id}/items`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ lines: cartLines() }),
            });
            if (!addRes.ok) {
              const errJson = await addRes.json().catch(() => ({}));
              throw new Error(errJson.error || "Failed to append items to order");
            }
            orderNumber = activeOrder.orderNumber || orderNumber;
            printOrderId = activeOrder.id;
          } else {
            const kotRes = await authedFetch("/orders", {
              method: "POST",
              body: JSON.stringify({
                action: "KOT",
                orderType: orderMode,
                ...orderTableBinding(),
                covers: coversCount,
                waiterName,
                customerId,
                lines: cartLines(),
                status: "KOT_CREATED",
              }),
            });
            if (!kotRes.ok) {
              const errJson = await kotRes.json().catch(() => ({}));
              throw new Error(errJson.error || "Failed to open order for unpaid bill");
            }
            const kotData = await kotRes.json();
            orderNumber = kotData.orderNumber || orderNumber;
            printOrderId = kotData.id || printOrderId;
          }
        }
        if (printOrderId) {
          await authedFetch(`/orders/${printOrderId}/print`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ document_type: "bill" }),
          }).catch(() => {});
        }
        setReceiptModal({
          orderNumber,
          tableNumber,
          paymentMethod,
          totalSubtotalMinor,
          taxMinor,
          grandTotalMinor,
          items: allDisplayItems,
          createdAt: new Date().toISOString(),
          settled: false,
        });
        setCart([]);
        await loadActiveTableOrder();
        // #region agent log
        fetch("http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"9c675b"},body:JSON.stringify({sessionId:"9c675b",hypothesisId:"L4",location:"PosBillingView.tsx:handlePrintAndEBill",message:"unpaid print skipped settle",data:{orderNumber,printOrderId,paymentMethod,settleNow:false},timestamp:Date.now(),runId:"leftover-post"})}).catch(()=>{});
        // #endregion
        return;
      }

      if (activeOrder?.id) {
        // If there are staged cart items, append them first
        if (cart.length > 0) {
          const addRes = await authedFetch(`/orders/${activeOrder.id}/items`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lines: cartLines(),
            }),
          });
          if (!addRes.ok) {
            const errJson = await addRes.json().catch(() => ({}));
            throw new Error(errJson.error || "Failed to append items to order");
          }
        }

        // Settle active order
        const settleRes = await authedFetch(`/orders/${activeOrder.id}/settle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentMethod,
            amountPaidMinor: grandTotalMinor,
            customerId,
          }),
        });

        if (!settleRes.ok) {
          const errJson = await settleRes.json().catch(() => ({}));
          throw new Error(errJson.error || "Failed to settle order");
        }
        const settleData = await settleRes.json().catch(() => ({} as any));
        const invoiceLabel = Array.isArray(settleData.invoiceNumbers) && settleData.invoiceNumbers.length > 0
          ? settleData.invoiceNumbers.join(" + ")
          : (settleData.invoiceNumber || orderNumber);
        orderNumber = invoiceLabel;
        // #region agent log
        fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'R1',location:'PosBillingView.tsx:handlePrintAndEBill',message:'print settle invoice label',data:{invoiceLabel,invoiceNumbers:settleData.invoiceNumbers||null,invoiceNumber:settleData.invoiceNumber||null,orderId:activeOrder.id},timestamp:Date.now(),runId:'waiter-e2e'})}).catch(()=>{});
        // #endregion
      } else {
        const payload = {
          action: "BILL",
          orderType: orderMode,
          ...orderTableBinding(),
          covers: coversCount,
          waiterName,
          paymentMethod,
          isPaid: true,
          customerId,
          lines: cartLines(),
          subtotalMinor: totalSubtotalMinor,
          taxTotalMinor: taxMinor,
          grandTotalMinor,
        };

        const res = await authedFetch("/orders", {
          method: "POST",
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || "Failed to generate bill");
        }

        const resData = await res.json();
        const billedLabel = Array.isArray(resData.invoiceNumbers) && resData.invoiceNumbers.length > 0
          ? resData.invoiceNumbers.join(" + ")
          : (resData.invoiceNumber || resData.orderNumber || "INV-001");
        orderNumber = billedLabel;
      }

      setReceiptModal({
        orderNumber,
        tableNumber,
        paymentMethod,
        totalSubtotalMinor,
        taxMinor,
        grandTotalMinor,
        items: allDisplayItems,
        createdAt: new Date().toISOString(),
        settled: true,
      });

      setCart([]);
      setRunningItems([]);
      setActiveOrder(null);
    } catch (err: any) {
      alert(err.message || "Failed to generate bill");
    } finally {
      setProcessingOrder(false);
    }
  };

  // Wires the Split Bill modal to the real settle pipeline. The backend
  // accepts a payments[] array on POST /orders/:id/settle (each { method,
  // amountMinor }); an EQUAL split becomes N payment rows that sum exactly to
  // the bill total (last row absorbs the rounding remainder). Previously this
  // only fired an alert() and never settled.
  const handleConfirmSplit = async (details: { splitType: string; numGuests: number; perGuestMinor: number }) => {
    if (modePausedReason) {
      alert(modePausedReason);
      return;
    }
    if (!isPaidChecked) {
      alert("Check It's Paid before splitting. Unpaid bills stay open on the table.");
      return;
    }
    setIsSplitModalOpen(false);
    setProcessingOrder(true);
    try {
      let orderId = activeOrder?.id;
      if (!orderId) {
        if (cart.length === 0) {
          alert("Add items before splitting the bill.");
          return;
        }
        const createRes = await authedFetch("/orders", {
          method: "POST",
          body: JSON.stringify({
            action: "KOT",
            orderType: orderMode,
            ...orderTableBinding(),
            covers: coversCount,
            waiterName,
            customerId: await existingOrResolvedCustomerId({ existingId: activeOrder?.customerId, phone: guestPhone, name: guestName }),
            lines: cartLines(),
          }),
        });
        if (!createRes.ok) {
          const e = await createRes.json().catch(() => ({}));
          throw new Error(e.error || "Failed to create order for split");
        }
        orderId = (await createRes.json()).id;
      } else if (cart.length > 0) {
        const addRes = await authedFetch(`/orders/${orderId}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lines: cartLines(),
          }),
        });
        if (!addRes.ok) {
          const e = await addRes.json().catch(() => ({}));
          throw new Error(e.error || "Failed to append items before split");
        }
      }

      const total = grandTotalMinor;
      const n = Math.max(1, details.numGuests || 1);
      const method = paymentMethod || "CASH";
      // #region agent log
      fetch("http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"9c675b"},body:JSON.stringify({sessionId:"9c675b",hypothesisId:"DUE3",location:"PosBillingView.tsx:handleConfirmSplit",message:"split remaps due",data:{paymentMethod,mappedMethod:method,isPaidChecked},timestamp:Date.now(),runId:"due-print"})}).catch(()=>{});
      // #endregion
      const payments: { method: string; amountMinor: number }[] = [];
      if (details.splitType === "EQUAL") {
        const base = Math.floor(total / n);
        for (let i = 0; i < n; i++) {
          payments.push({ method, amountMinor: i === n - 1 ? total - base * (n - 1) : base });
        }
      } else {
        const lineTotals = [
          ...runningItems.map((r) => r.subtotalMinor),
          ...cart.map((c) => c.itemTotalMinor),
        ];
        const lineSum = lineTotals.reduce((s, v) => s + v, 0);
        if (lineTotals.length < 2 || lineSum <= 0) {
          const base = Math.floor(total / 2);
          payments.push({ method, amountMinor: base }, { method, amountMinor: total - base });
        } else {
          const mid = Math.ceil(lineTotals.length / 2);
          const firstShare = lineTotals.slice(0, mid).reduce((s, v) => s + v, 0);
          const first = Math.min(total, Math.round((firstShare / lineSum) * total));
          payments.push({ method, amountMinor: first }, { method, amountMinor: total - first });
        }
      }

      const settleRes = await authedFetch(`/orders/${orderId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payments,
          customerId: await existingOrResolvedCustomerId({ existingId: activeOrder?.customerId, phone: guestPhone, name: guestName }),
        }),
      });
      if (!settleRes.ok) {
        const e = await settleRes.json().catch(() => ({}));
        throw new Error(e.error || "Failed to settle split bill");
      }
      const settleData = await settleRes.json().catch(() => ({} as any));
      const invoiceLabel = Array.isArray(settleData.invoiceNumbers) && settleData.invoiceNumbers.length > 0
        ? settleData.invoiceNumbers.join(" + ")
        : (settleData.invoiceNumber || activeOrder?.orderNumber || "SPLIT");
      // #region agent log
      fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'E',location:'PosBillingView.tsx:handleConfirmSplit',message:'split settle response',data:{orderId,paymentCount:payments.length,invoiceLabel,invoiceNumbers:settleData.invoiceNumbers||null,invoiceNumber:settleData.invoiceNumber||null},timestamp:Date.now(),runId:'chrome-split'})}).catch(()=>{});
      // #endregion

      setReceiptModal({
        orderNumber: invoiceLabel,
        tableNumber,
        paymentMethod: `${method} · Split ${payments.length}`,
        totalSubtotalMinor,
        taxMinor,
        grandTotalMinor: total,
        items: [
          ...runningItems.map((r) => ({ name: r.menuItemName, qty: r.quantity, price: r.subtotalMinor })),
          ...cart.map((c) => ({ name: c.item.name, qty: c.quantity, price: c.itemTotalMinor })),
        ],
        createdAt: new Date().toISOString(),
      });
      setCart([]);
      setRunningItems([]);
      setActiveOrder(null);
    } catch (err: any) {
      alert(err.message || "Failed to split bill");
    } finally {
      setProcessingOrder(false);
    }
  };

  const addCustomizedToCart = (item: MenuItemData, customization: CustomizedItemSelection) => {
    const customizedName = `${item.name} (${customization.portion === "HALF" ? "Half" : customization.portion === "FULL" ? "Full" : "Reg"}${customization.addons.length > 0 ? " + " + customization.addons.map((a) => a.name).join(", ") : ""})`;
    const customItem: MenuItem = {
      id: item.id,
      name: customizedName,
      category: item.category,
      priceMinor: customization.finalPriceMinor,
      isVeg: item.isVeg,
      isStocked: item.isStocked ?? true,
      stockQty: item.stockQty ?? 100,
      taxRate: catalog.find((c) => c.id === item.id)?.taxRate ?? 0,
    };

    setCart((prev) => [
      ...prev,
      {
        cartItemId: `item_${Date.now()}_${Math.random()}`,
        item: customItem,
        quantity: 1,
        itemTotalMinor: customization.finalPriceMinor,
        notes: customization.specialInstructions || undefined,
        modifierOptionIds: customization.modifierOptionIds || [],
        checked: true,
      },
    ]);
  };

  const categoryItemCounts = useMemo(() => {
    const counts: Record<string, number> = { All: catalog.length };
    for (const item of catalog) {
      counts[item.category] = (counts[item.category] || 0) + 1;
    }
    return counts;
  }, [catalog]);

  const filteredCatalog = useMemo(() => {
    return catalog.filter((item) => {
      const matchCat = selectedCategory === "All" || item.category === selectedCategory;
      const matchSearch =
        !searchQuery ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.category.toLowerCase().includes(searchQuery.toLowerCase());

      let matchDiet = true;
      if (dietaryFilter === "VEG_ONLY") matchDiet = item.isVeg === true;
      else if (dietaryFilter === "NON_VEG_ONLY") matchDiet = item.isVeg === false;
      else if (dietaryFilter === "BESTSELLERS_ONLY") matchDiet = item.priceMinor > 8000 && item.priceMinor < 30000;

      return matchCat && matchSearch && matchDiet;
    });
  }, [catalog, selectedCategory, searchQuery, dietaryFilter]);

  return (
    <div className="pos-billing-container">
      {/* Mode Switcher Bar */}
      <div className="pos-mode-bar">
        <div className="mode-tabs">
          <button
            type="button"
            className={`mode-tab ${orderMode === "DINE_IN" ? "active" : ""}`}
            disabled={Boolean(channelPausedMessage(channelOps, "DINE_IN"))}
            onClick={() => {
              // #region agent log
              fetch("http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"9c675b"},body:JSON.stringify({sessionId:"9c675b",hypothesisId:"CH4",location:"PosBillingView.tsx:mode-tab",message:"switch dine-in",data:{paused:Boolean(channelPausedMessage(channelOps,"DINE_IN"))},timestamp:Date.now(),runId:"channel-pause"})}).catch(()=>{});
              // #endregion
              setOrderMode("DINE_IN");
            }}
          >
            🍽️ Dine In
          </button>
          <button
            type="button"
            className={`mode-tab ${orderMode === "DELIVERY" ? "active" : ""}`}
            disabled={Boolean(channelPausedMessage(channelOps, "DELIVERY"))}
            onClick={() => {
              // #region agent log
              fetch("http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"9c675b"},body:JSON.stringify({sessionId:"9c675b",hypothesisId:"CH4",location:"PosBillingView.tsx:mode-tab",message:"switch delivery",data:{paused:Boolean(channelPausedMessage(channelOps,"DELIVERY"))},timestamp:Date.now(),runId:"channel-pause"})}).catch(()=>{});
              // #endregion
              setOrderMode("DELIVERY");
            }}
          >
            🛵 Delivery
          </button>
          <button
            type="button"
            className={`mode-tab ${orderMode === "PICKUP" ? "active" : ""}`}
            disabled={Boolean(channelPausedMessage(channelOps, "PICKUP"))}
            onClick={() => {
              // #region agent log
              fetch("http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"9c675b"},body:JSON.stringify({sessionId:"9c675b",hypothesisId:"CH4",location:"PosBillingView.tsx:mode-tab",message:"switch pickup",data:{paused:Boolean(channelPausedMessage(channelOps,"PICKUP"))},timestamp:Date.now(),runId:"channel-pause"})}).catch(()=>{});
              // #endregion
              setOrderMode("PICKUP");
            }}
          >
            🛍️ Pick Up
          </button>
        </div>
        {modePausedReason && (
          <div role="status" style={{ fontSize: 12, fontWeight: 700, color: "#b91c1c" }}>
            {modePausedReason}
          </div>
        )}
        {offFloor && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#475569" }}>
            Schedule kitchen
            <input
              type="datetime-local"
              value={scheduleFireAt}
              onChange={(e) => setScheduleFireAt(e.target.value)}
              style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "4px 8px" }}
            />
          </label>
        )}

        {onBackToTables && (
          <button type="button" className="btn-back-tables" onClick={onBackToTables}>
            ← Back to Table View
          </button>
        )}
      </div>

      {/* Main 3-Column Layout */}
      <div className="pos-main-grid">
        {/* Column 1: Category Navigation */}
        <div className="pos-categories-sidebar">
          <CategoryNavbar
            categories={categories}
            selectedCategory={selectedCategory}
            onSelectCategory={(cat) => setSelectedCategory(cat)}
            dietaryFilter={dietaryFilter}
            onChangeDietaryFilter={(f) => setDietaryFilter(f)}
            searchQuery={searchQuery}
            onSearchChange={(q) => setSearchQuery(q)}
            categoryItemCounts={categoryItemCounts}
            layout="vertical"
          />
        </div>

        {/* Column 2: Item Grid & Search */}
        <div className="pos-item-grid-panel">
          <div className="items-matrix-scroll">
            {loading ? (
              <div style={{ textAlign: "center", padding: "40px", color: "#94a3b8" }}>
                Loading menu catalog...
              </div>
            ) : filteredCatalog.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px", color: "#94a3b8" }}>
                No items found matching the current filters.
              </div>
            ) : (
              <div className="items-card-grid">
                {filteredCatalog.map((item) => {
                  const cartItem = cart.find((c) => c.item.id === item.id);
                  const cartQuantity = cartItem ? cartItem.quantity : 0;

                  return (
                    <AttractiveMenuItemCard
                      key={item.id}
                      item={{
                        ...item,
                        isBestseller: item.priceMinor > 8000 && item.priceMinor < 30000,
                      }}
                      cartQuantity={cartQuantity}
                      onAdd={(it) => addToCart(item)}
                      onIncrement={(it) => {
                        if (cartItem) updateCartItemQty(cartItem.cartItemId, 1);
                        else addToCart(item);
                      }}
                      onDecrement={(it) => {
                        if (cartItem) updateCartItemQty(cartItem.cartItemId, -1);
                      }}
                      onCustomize={(it) => setCustomizingItem(it)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Column 3: Cart, Ticket & Settlement */}
        <div className="pos-cart-panel">
          {/* Table Header Bar */}
          <div className="cart-table-meta-bar">
            <div className="table-badge-group">
              <span className="table-tag-icon">T</span>
              <span className="table-name-label">{offFloor ? orderMode : tableNumber}</span>
              <span className="section-badge">{offFloor ? "Off floor" : tableSection}</span>
              {runningItems.length > 0 && (
                <span className="live-running-badge">● Running Order</span>
              )}
            </div>

            <div className="covers-waiter-group">
              <div className="covers-counter">
                <span>👤</span>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={coversCount}
                  onChange={(e) => setCoversCount(Number(e.target.value))}
                  className="covers-input"
                />
              </div>
              <div className="waiter-tag">
                <span>🧑‍🍳</span>
                <span>{waiterName}</span>
              </div>
              <input
                type="tel"
                className="covers-input"
                style={{ width: "110px" }}
                placeholder="Guest phone"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                title="Phone for CRM loyalty"
              />
              <input
                type="text"
                className="covers-input"
                style={{ width: "90px" }}
                placeholder="Name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                title="Guest name"
              />
            </div>
          </div>

          {/* Cart Table Headers */}
          <div className="cart-table-headers">
            <span className="col-item">ITEMS</span>
            <span className="col-check">CHECK</span>
            <span className="col-qty">QTY</span>
            <span className="col-price">PRICE</span>
          </div>

          {/* Cart Items List */}
          <div className="cart-items-scroll">
            {runningItems.length === 0 && cart.length === 0 ? (
              <div className="empty-cart-state">
                <div style={{ fontSize: "2.5rem", color: "#cbd5e1" }}>🍽️</div>
                <div style={{ fontWeight: 700, color: "#64748b", marginTop: "8px" }}>No Item Selected</div>
                <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                  Please Select Item from Left Menu Item Grid
                </div>
              </div>
            ) : (
              <>
                {/* 1. Multi-KOT Running / Dispatched Items with Real-time Stage Badges */}
                {tableKots.length > 0 ? (
                  <div className="running-section-group">
                    <div className="running-section-header">
                      <span>🍳 RUNNING KOTS ({tableKots.length} Waves)</span>
                      <span>₹{(runningSubtotalMinor / 100).toFixed(2)}</span>
                    </div>

                    {tableKots.map((kot) => (
                      <div key={kot.id} className="kot-wave-card" style={{ marginBottom: "8px", background: "#f8fafc", borderRadius: "6px", padding: "6px 8px", border: "1px solid #e2e8f0" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px", fontSize: "0.75rem" }}>
                          <div>
                            <strong style={{ color: "#334155" }}>KOT #{kot.ticketNumber}</strong>
                            <span style={{ color: "#94a3b8", marginLeft: "6px" }}>{new Date(kot.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            {kot.status === "SERVED" && (
                              <span style={{ background: "#ecfdf5", color: "#059669", border: "1px solid #a7f3d0", padding: "1px 6px", borderRadius: "4px", fontWeight: 700, fontSize: "10px" }}>
                                ✅ SERVED
                              </span>
                            )}
                            {kot.status === "READY" && (
                              <span style={{ background: "#fef3c7", color: "#d97706", border: "1px solid #fde68a", padding: "1px 6px", borderRadius: "4px", fontWeight: 800, fontSize: "10px", animation: "pulse 1.5s infinite" }}>
                                🔔 READY
                              </span>
                            )}
                            {(kot.status === "PREPARING" || (kot.status as string) === "IN_PREPARATION") && (
                              <span style={{ background: "#fef9c3", color: "#ca8a04", border: "1px solid #fef08a", padding: "1px 6px", borderRadius: "4px", fontWeight: 700, fontSize: "10px" }}>
                                👨‍🍳 COOKING
                              </span>
                            )}
                            {(kot.status === "QUEUED" || (kot.status as string) === "KOT_CREATED" || (kot.status as string) === "PENDING") && (
                              <span style={{ background: "#e0f2fe", color: "#0284c7", border: "1px solid #bae6fd", padding: "1px 6px", borderRadius: "4px", fontWeight: 700, fontSize: "10px" }}>
                                🟡 QUEUED
                              </span>
                            )}

                            {kot.status === "READY" && (
                              <button
                                type="button"
                                style={{ background: "#10b981", color: "#fff", border: "none", borderRadius: "4px", padding: "2px 6px", fontSize: "10px", fontWeight: 700, cursor: "pointer" }}
                                onClick={() => handleServeKot(kot.id)}
                                title="Mark this KOT served to table"
                              >
                                🍽️ Serve
                              </button>
                            )}
                          </div>
                        </div>

                        {kot.items.map((kItem) => (
                          <div key={kItem.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.8125rem", padding: "2px 0", borderTop: "1px dotted #f1f5f9" }}>
                            <span>{kItem.quantity}x {kItem.name}</span>
                            <span style={{ fontSize: "10px", color: kItem.status === "SERVED" ? "#059669" : "#64748b" }}>
                              {kItem.status === "SERVED" ? "Served" : "In Kitchen"}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : runningItems.length > 0 ? (
                  <div className="running-section-group">
                    <div className="running-section-header">
                      <span>🍳 RUNNING KOT ITEMS (Dispatched)</span>
                      <span>₹{(runningSubtotalMinor / 100).toFixed(2)}</span>
                    </div>
                    {runningItems.map((rItem) => (
                      <div key={rItem.id} className="cart-row running-row">
                        <div className="cart-col-item">
                          <span className="kot-tag">KOT</span>
                          <span className="cart-item-name">{rItem.menuItemName}</span>
                        </div>
                        <div className="cart-col-check">
                          <span style={{ color: "#16a34a", fontSize: "0.75rem" }}>✓ Sent</span>
                        </div>
                        <div className="cart-col-qty">
                          <span className="qty-val" style={{ fontWeight: 700 }}>{rItem.quantity}</span>
                        </div>
                        <div className="cart-col-price">
                          ₹{(rItem.subtotalMinor / 100).toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* 2. Newly Added Cart Items to Send */}
                {cart.length > 0 && (
                  <div className="new-section-group">
                    {runningItems.length > 0 && (
                      <div className="new-section-header">
                        <span>➕ NEW ITEMS (To Dispatch)</span>
                        <span>₹{(cartSubtotalMinor / 100).toFixed(2)}</span>
                      </div>
                    )}
                    {cart.map((cartItem) => (
                      <div key={cartItem.cartItemId} className="cart-row new-row">
                        <div className="cart-col-item">
                          <span className={`veg-dot ${cartItem.item.isVeg ? "veg" : "non-veg"}`}>●</span>
                          <span className="cart-item-name">{cartItem.item.name}</span>
                        </div>

                        <div className="cart-col-check">
                          <input
                            type="checkbox"
                            checked={cartItem.checked}
                            onChange={() => toggleCheckItem(cartItem.cartItemId)}
                          />
                        </div>

                        <div className="cart-col-qty">
                          <button
                            type="button"
                            className="qty-btn"
                            onClick={() => updateCartItemQty(cartItem.cartItemId, -1)}
                          >
                            -
                          </button>
                          <span className="qty-val">{cartItem.quantity}</span>
                          <button
                            type="button"
                            className="qty-btn"
                            onClick={() => updateCartItemQty(cartItem.cartItemId, 1)}
                          >
                            +
                          </button>
                        </div>

                        <div className="cart-col-price">
                          ₹{(cartItem.itemTotalMinor / 100).toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Cart Summary & Rapid Settlement Footer (Sticky at Bottom) */}
          <div className="cart-settlement-footer">
            {/* Split & Tender Modes */}
            <div className="tender-action-bar">
              <button
                type="button"
                className="btn-split"
                onClick={() => setIsSplitModalOpen(true)}
              >
                Split
              </button>

              <div className="payment-pills-row">
                <label className={`payment-pill ${paymentMethod === "CASH" ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="paymentMode"
                    value="CASH"
                    checked={paymentMethod === "CASH"}
                    onChange={() => setPaymentMethod("CASH")}
                  />
                  <span>Cash</span>
                </label>

                <label className={`payment-pill ${paymentMethod === "CARD" ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="paymentMode"
                    value="CARD"
                    checked={paymentMethod === "CARD"}
                    onChange={() => setPaymentMethod("CARD")}
                  />
                  <span>Card</span>
                </label>

                <label className={`payment-pill ${paymentMethod === "DUE" ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="paymentMode"
                    value="DUE"
                    checked={paymentMethod === "DUE"}
                    onChange={() => setPaymentMethod("DUE")}
                  />
                  <span>Due</span>
                </label>

                <label className={`payment-pill ${paymentMethod === "OTHER" ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="paymentMode"
                    value="OTHER"
                    checked={paymentMethod === "OTHER"}
                    onChange={() => setPaymentMethod("OTHER")}
                  />
                  <span>Other</span>
                </label>

                <label className="paid-checkbox-label">
                  <input
                    type="checkbox"
                    checked={isPaidChecked}
                    onChange={(e) => setIsPaidChecked(e.target.checked)}
                  />
                  <span>It's Paid</span>
                </label>
              </div>

              <div className="total-display-badge">
                <span className="total-label">Total</span>
                <span className="total-value">₹{(grandTotalMinor / 100).toFixed(2)}</span>
              </div>
            </div>

            {/* Bottom Primary CTAs (Sticky & Always Visible) */}
            <div className="cart-cta-buttons">
              <button
                type="button"
                className="btn-hold-cart"
                onClick={handleHoldCart}
                disabled={processingOrder || Boolean(modePausedReason)}
                title="Park / Hold Order"
              >
                ⏸ Hold
              </button>

              <button
                type="button"
                className="btn-print-ebill"
                onClick={handlePrintAndEBill}
                disabled={processingOrder || Boolean(modePausedReason) || (cart.length === 0 && runningItems.length === 0)}
              >
                {processingOrder ? "Printing..." : "Print & E-Bill"}
              </button>

              <button
                type="button"
                className="btn-kot-print"
                onClick={handleKotAndPrint}
                disabled={processingOrder || Boolean(modePausedReason) || (cart.length === 0 && runningItems.length === 0)}
              >
                {processingOrder ? "Sending..." : "KOT & Print"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bill Split Modal */}
      {isSplitModalOpen && (
        <BillSplitModal
          totalMinor={grandTotalMinor}
          cart={cart}
          onClose={() => setIsSplitModalOpen(false)}
          onConfirmSplit={handleConfirmSplit}
        />
      )}

      {/* Menu Customizer Modal */}
      {customizingItem && (
        <MenuCustomizerModal
          item={customizingItem}
          onClose={() => setCustomizingItem(null)}
          onAddToCart={addCustomizedToCart}
        />
      )}

      {/* KOT Dispatched Success Dialog */}
      {kotFeedback && (
        <div className="modal-backdrop" onClick={() => setKotFeedback(null)}>
          <div className="modal-dialog-card" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header success-header">
              <span style={{ fontSize: "1.5rem" }}>{kotFeedback.deferredUntil ? "🗓️" : "🍳"}</span>
              <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 800 }}>
                {kotFeedback.deferredUntil ? "Advance order scheduled" : "KOT Ticket Dispatched!"}
              </h3>
            </div>
            <div className="dialog-body">
              <p style={{ margin: "0 0 12px", color: "#334155", fontWeight: 600 }}>
                {kotFeedback.deferredUntil
                  ? `Order #${kotFeedback.orderNumber} is scheduled for kitchen fire at ${new Date(kotFeedback.deferredUntil).toLocaleString("en-IN")} for ${offFloor ? orderMode : `Table ${tableNumber}`}. Kitchen KDS will not see it until then.`
                  : `KOT #${kotFeedback.orderNumber} sent to Kitchen KDS for ${offFloor ? orderMode : `Table ${tableNumber}`}:`}
              </p>
              <ul className="dispatched-items-list">
                {kotFeedback.items.map((it, idx) => (
                  <li key={idx} style={{ padding: "4px 0", borderBottom: "1px dashed #e2e8f0" }}>{it}</li>
                ))}
              </ul>
            </div>
            <div className="dialog-footer">
              <button
                type="button"
                className="btn-dialog-primary"
                onClick={() => setKotFeedback(null)}
              >
                Continue Ordering
              </button>
              {onBackToTables && (
                <button
                  type="button"
                  className="btn-dialog-secondary"
                  onClick={() => {
                    setKotFeedback(null);
                    onBackToTables();
                  }}
                >
                  Return to Floor View →
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* POS Thermal Receipt Modal */}
      {receiptModal && (
        <div className="modal-backdrop" onClick={() => setReceiptModal(null)}>
          <div className="modal-dialog-card receipt-card" onClick={(e) => e.stopPropagation()}>
            <div className="receipt-paper">
              <div className="receipt-header">
                <h3 style={{ margin: 0, fontWeight: 900 }}>{outletProfile?.name || "Outlet"}</h3>
                {outletProfile?.taxNumber ? (
                  <div style={{ fontSize: "0.75rem", color: "#64748b" }}>GSTIN: {outletProfile.taxNumber}</div>
                ) : null}
                {outletProfile?.address ? (
                  <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{outletProfile.address}</div>
                ) : null}
                <div className="receipt-divider">================================</div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem", fontWeight: 700 }}>
                  <span>Table: {receiptModal.tableNumber}</span>
                  <span>{receiptModal.settled === false ? "Order #" : "Inv #"}{receiptModal.orderNumber}</span>
                </div>
                <div style={{ fontSize: "0.75rem", color: "#64748b", textAlign: "left", marginTop: "2px" }}>
                  Date: {new Date(receiptModal.createdAt).toLocaleString()}
                </div>
                <div className="receipt-divider">--------------------------------</div>
              </div>

              <div className="receipt-items-list">
                {receiptModal.items.map((it: any, idx: number) => (
                  <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem", padding: "3px 0" }}>
                    <span>{it.qty}x {it.name}</span>
                    <span style={{ fontWeight: 700 }}>₹{(it.price / 100).toFixed(2)}</span>
                  </div>
                ))}
              </div>

              <div className="receipt-divider">--------------------------------</div>

              <div className="receipt-totals">
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem" }}>
                  <span>Subtotal (incl. GST):</span>
                  <span>₹{(receiptModal.totalSubtotalMinor / 100).toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#64748b" }}>
                  <span>{displayTaxRate > 0 ? `CGST (${(displayTaxRate / 2).toFixed(2)}%):` : "CGST (incl.):"}</span>
                  <span>₹{((receiptModal.taxMinor / 2) / 100).toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#64748b" }}>
                  <span>{displayTaxRate > 0 ? `SGST (${(displayTaxRate / 2).toFixed(2)}%):` : "SGST (incl.):"}</span>
                  <span>₹{((receiptModal.taxMinor / 2) / 100).toFixed(2)}</span>
                </div>
                <div className="receipt-divider">================================</div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "1.125rem", fontWeight: 900 }}>
                  <span>GRAND TOTAL:</span>
                  <span>₹{(receiptModal.grandTotalMinor / 100).toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem", color: receiptModal.settled === false ? "#b45309" : "#16a34a", fontWeight: 700, marginTop: "4px" }}>
                  <span>{receiptModal.settled === false ? "AMOUNT DUE:" : `Paid via ${receiptModal.paymentMethod}:`}</span>
                  <span>₹{(receiptModal.grandTotalMinor / 100).toFixed(2)}</span>
                </div>
              </div>

              <div className="receipt-footer" style={{ textAlign: "center", marginTop: "16px", fontSize: "0.75rem", color: "#64748b" }}>
                <div>*** THANK YOU FOR DINING WITH US ***</div>
                <div>Visit Again Soon!</div>
              </div>
            </div>

            <div className="receipt-actions">
              <button
                type="button"
                className="btn-print-duplicate"
                onClick={() => {
                  window.print();
                }}
              >
                🖨️ Print Receipt
              </button>
              {receiptModal.settled !== false ? (
              <button
                type="button"
                style={{ background: "#4f46e5", color: "#fff", border: "none", padding: "8px 14px", borderRadius: "6px", fontWeight: 700, cursor: "pointer", fontSize: "0.8125rem" }}
                onClick={async () => {
                  await handleVacateTable();
                  setReceiptModal(null);
                }}
              >
                🧹 Clear & Mark Vacant
              </button>
              ) : null}
              <button
                type="button"
                className="btn-close-receipt"
                onClick={() => {
                  setReceiptModal(null);
                  if (onBackToTables) onBackToTables();
                }}
              >
                Done / Back to Floor
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .pos-billing-container {
          display: flex;
          flex-direction: column;
          height: calc(100vh - 56px);
          max-height: calc(100vh - 56px);
          background: #f8fafc;
          overflow: hidden;
        }

        .pos-mode-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 14px;
          background: #ffffff;
          border-bottom: 1px solid #e2e8f0;
          flex-shrink: 0;
        }
        .mode-tabs {
          display: flex;
          gap: 6px;
        }
        .mode-tab {
          background: transparent;
          border: none;
          padding: 6px 14px;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 700;
          color: #64748b;
          cursor: pointer;
        }
        .mode-tab:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          text-decoration: line-through;
        }
        .mode-tab.active {
          background: #f1f5f9;
          color: #dc2626;
          box-shadow: inset 0 -2px 0 #dc2626;
        }
        .btn-back-tables {
          background: transparent;
          border: 1px solid #cbd5e1;
          padding: 4px 12px;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 700;
          color: #475569;
          cursor: pointer;
        }
        .btn-back-tables:hover {
          background: #f1f5f9;
          color: #0f172a;
        }

        .pos-main-grid {
          display: grid;
          grid-template-columns: 180px 1fr 390px;
          flex: 1;
          min-height: 0;
          overflow: hidden;
        }

        /* Column 1: Categories */
        .pos-categories-sidebar {
          background: #ffffff;
          border-right: 1px solid #e2e8f0;
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
          overflow: hidden;
        }

        /* Column 2: Item Grid */
        .pos-item-grid-panel {
          display: flex;
          flex-direction: column;
          background: #f8fafc;
          border-right: 1px solid #e2e8f0;
          height: 100%;
          min-height: 0;
          overflow: hidden;
        }
        .items-matrix-scroll {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding: 12px;
        }
        .items-card-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(155px, 1fr));
          gap: 12px;
        }

        /* Column 3: Cart & Settlement (Strict Vertical Flex Layout) */
        .pos-cart-panel {
          display: flex;
          flex-direction: column;
          background: #ffffff;
          height: 100%;
          min-height: 0;
          overflow: hidden;
        }
        .cart-table-meta-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          border-bottom: 1px solid #e2e8f0;
          background: #f8fafc;
          flex-shrink: 0;
        }
        .table-badge-group {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .table-tag-icon {
          background: #dc2626;
          color: #ffffff;
          font-weight: 900;
          padding: 1px 6px;
          border-radius: 3px;
          font-size: 0.75rem;
        }
        .table-name-label {
          font-weight: 800;
          font-size: 0.9rem;
        }
        .section-badge {
          font-size: 0.6875rem;
          background: #e2e8f0;
          color: #475569;
          padding: 1px 6px;
          border-radius: 3px;
        }
        .live-running-badge {
          font-size: 0.6875rem;
          background: #fef3c7;
          color: #92400e;
          font-weight: 800;
          padding: 1px 6px;
          border-radius: 3px;
          border: 1px solid #fde68a;
        }
        .covers-waiter-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .covers-counter {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 0.75rem;
        }
        .covers-input {
          width: 32px;
          padding: 2px;
          text-align: center;
          border: 1px solid #cbd5e1;
          border-radius: 3px;
          font-size: 0.75rem;
        }
        .waiter-tag {
          font-size: 0.75rem;
          color: #64748b;
          display: flex;
          align-items: center;
          gap: 3px;
        }

        .cart-table-headers {
          display: grid;
          grid-template-columns: 1.5fr 60px 65px 70px;
          padding: 6px 12px;
          background: #f1f5f9;
          font-size: 0.6875rem;
          font-weight: 800;
          color: #64748b;
          border-bottom: 1px solid #e2e8f0;
          flex-shrink: 0;
        }
        .col-price { text-align: right; }
        .col-qty, .col-check { text-align: center; }

        .cart-items-scroll {
          flex: 1 1 0;
          min-height: 0;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
        }
        .empty-cart-state {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 32px;
          text-align: center;
        }

        .running-section-group {
          background: #fffbeb;
          border-bottom: 2px solid #fef08a;
        }
        .running-section-header {
          display: flex;
          justify-content: space-between;
          padding: 4px 12px;
          font-size: 0.6875rem;
          font-weight: 800;
          color: #92400e;
          background: #fef9c3;
        }
        .new-section-group {
          background: #ffffff;
        }
        .new-section-header {
          display: flex;
          justify-content: space-between;
          padding: 4px 12px;
          font-size: 0.6875rem;
          font-weight: 800;
          color: #1e40af;
          background: #eff6ff;
        }

        .cart-row {
          display: grid;
          grid-template-columns: 1.5fr 60px 65px 70px;
          align-items: center;
          padding: 8px 12px;
          border-bottom: 1px solid #f1f5f9;
          font-size: 0.8125rem;
        }
        .running-row {
          background: #fffdf5;
        }
        .kot-tag {
          font-size: 0.625rem;
          font-weight: 900;
          background: #f59e0b;
          color: #ffffff;
          padding: 1px 4px;
          border-radius: 2px;
        }
        .cart-col-item {
          display: flex;
          align-items: center;
          gap: 6px;
          overflow: hidden;
        }
        .veg-dot {
          font-size: 0.75rem;
        }
        .veg-dot.veg { color: #16a34a; }
        .veg-dot.non-veg { color: #dc2626; }
        .cart-item-name {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-weight: 600;
        }
        .cart-col-check {
          text-align: center;
        }
        .cart-col-qty {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
        }
        .qty-btn {
          width: 20px;
          height: 20px;
          border: 1px solid #cbd5e1;
          background: #f8fafc;
          border-radius: 3px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
        }
        .qty-val {
          font-weight: 700;
          min-width: 14px;
          text-align: center;
        }
        .cart-col-price {
          text-align: right;
          font-weight: 700;
          color: #16a34a;
        }

        /* Settlement Footer (Strictly Pinned at Bottom) */
        .cart-settlement-footer {
          flex-shrink: 0;
          border-top: 1px solid #e2e8f0;
          background: #ffffff;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          box-shadow: 0 -2px 6px rgba(0,0,0,0.04);
        }
        .tender-action-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 6px;
        }
        .btn-split {
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.6875rem;
          font-weight: 700;
          cursor: pointer;
        }
        .payment-pills-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .payment-pill {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 0.6875rem;
          font-weight: 600;
          cursor: pointer;
          padding: 2px 4px;
          border-radius: 4px;
        }
        .payment-pill input {
          margin: 0;
        }
        .paid-checkbox-label {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 0.6875rem;
          font-weight: 700;
          color: #2563eb;
          cursor: pointer;
        }

        .total-display-badge {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .total-label {
          font-size: 0.75rem;
          color: #64748b;
        }
        .total-value {
          font-size: 1.125rem;
          font-weight: 900;
          color: #0f172a;
        }

        .cart-cta-buttons {
          display: grid;
          grid-template-columns: 80px 1fr 1fr;
          gap: 8px;
        }
        .btn-hold-cart {
          background: #fef3c7;
          color: #92400e;
          border: 1px solid #fde68a;
          padding: 10px 6px;
          border-radius: 6px;
          font-size: 0.8125rem;
          font-weight: 700;
          cursor: pointer;
        }
        .btn-hold-cart:hover {
          background: #fde68a;
        }
        .btn-print-ebill {
          background: #dc2626;
          color: #ffffff;
          border: none;
          padding: 10px 12px;
          border-radius: 6px;
          font-size: 0.875rem;
          font-weight: 800;
          cursor: pointer;
          transition: background 0.15s;
        }
        .btn-print-ebill:hover:not(:disabled) {
          background: #b91c1c;
        }
        .btn-print-ebill:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .btn-kot-print {
          background: #2563eb;
          color: #ffffff;
          border: none;
          padding: 10px 12px;
          border-radius: 6px;
          font-size: 0.875rem;
          font-weight: 800;
          cursor: pointer;
          transition: background 0.15s;
        }
        .btn-kot-print:hover:not(:disabled) {
          background: #1d4ed8;
        }
        .btn-kot-print:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* Modal Dialogs */
        .modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(15, 23, 42, 0.6);
          backdrop-filter: blur(2px);
          z-index: 200;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .modal-dialog-card {
          background: #ffffff;
          border-radius: 10px;
          width: 90%;
          max-width: 440px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .dialog-header {
          padding: 16px 20px;
          display: flex;
          align-items: center;
          gap: 10px;
          color: #ffffff;
        }
        .success-header {
          background: #16a34a;
        }
        .dialog-body {
          padding: 20px;
          max-height: 350px;
          overflow-y: auto;
        }
        .dispatched-items-list {
          list-style: none;
          padding: 0;
          margin: 0;
          font-size: 0.875rem;
        }
        .dialog-footer {
          padding: 12px 20px;
          background: #f8fafc;
          border-top: 1px solid #e2e8f0;
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
        .btn-dialog-primary {
          background: #16a34a;
          color: #ffffff;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          font-weight: 700;
          font-size: 0.875rem;
          cursor: pointer;
        }
        .btn-dialog-secondary {
          background: #ffffff;
          color: #334155;
          border: 1px solid #cbd5e1;
          padding: 8px 16px;
          border-radius: 6px;
          font-weight: 700;
          font-size: 0.875rem;
          cursor: pointer;
        }

        /* Thermal Receipt Dialog */
        .receipt-card {
          max-width: 380px;
          background: #f8fafc;
        }
        .receipt-paper {
          background: #ffffff;
          padding: 20px;
          margin: 16px;
          border: 1px dashed #cbd5e1;
          box-shadow: 0 2px 4px rgba(0,0,0,0.05);
          font-family: 'Courier New', Courier, monospace;
        }
        .receipt-header {
          text-align: center;
        }
        .receipt-divider {
          color: #94a3b8;
          font-size: 0.75rem;
          margin: 4px 0;
          text-align: center;
        }
        .receipt-actions {
          padding: 12px 16px;
          background: #f1f5f9;
          border-top: 1px solid #e2e8f0;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .btn-print-duplicate {
          background: #0f172a;
          color: #ffffff;
          border: none;
          padding: 8px;
          border-radius: 6px;
          font-weight: 700;
          font-size: 0.8125rem;
          cursor: pointer;
        }
        .btn-close-receipt {
          background: #dc2626;
          color: #ffffff;
          border: none;
          padding: 8px;
          border-radius: 6px;
          font-weight: 700;
          font-size: 0.8125rem;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
