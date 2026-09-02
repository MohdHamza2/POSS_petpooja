import React, { useState, useEffect, useMemo } from "react";
import Head from "next/head";
import Link from "next/link";
import { authedFetch, useAuthGuard } from "../lib/auth";
import { useKapmetaSocket } from "../lib/useKapmetaSocket";
import Nav from "../components/Nav";

interface ItemAvailability {
  id: string; // menuItemId, used as the row key and for PATCH calls
  stockQty: number;
  isStocked: boolean;
  version: number;
  category: string;
  menuItem: {
    id: string;
    name: string;
    description: string;
    icon: string;
    priceFormatted: string;
    isVeg: boolean;
  };
}

interface AvailabilityApiRow {
  menuItemId: string;
  outletId: string;
  isStocked: boolean;
  stockQty: number;
  version: number;
  categoryName: string;
  name: string;
  priceMinor: string;
  isVeg: boolean;
}

interface RawIngredient {
  id: string;
  name: string;
  unitOfMeasure: string;
  reorderLevel: number;
  unitCost: number;
  currentStock: number;
}

interface RecipeIngredientRow {
  id: string;
  ingredientId: string;
  quantity: number;
  yieldPercent: number;
  ingredient: RawIngredient;
}

interface RecipeApi {
  id: string;
  menuItemId: string;
  version: number;
  isActive: boolean;
  recipeIngredients: RecipeIngredientRow[];
  menuItem?: {
    id: string;
    name: string;
    priceMinor: string;
    isVeg: boolean;
  };
}

interface VendorApi {
  id: string;
  name: string;
  phone: string;
  email?: string;
  taxNumber?: string;
}

interface PurchaseOrderApi {
  id: string;
  poNumber: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  vendor: VendorApi;
  items: {
    id: string;
    quantity: number;
    unitCost: number;
    totalCost: number;
    ingredient: RawIngredient;
  }[];
}

function formatPriceMinor(priceMinor?: string | number): string {
  if (priceMinor === undefined || priceMinor === null || priceMinor === "") return "₹0.00";
  try {
    const rupees = Number(priceMinor) / 100;
    return isNaN(rupees) ? "₹0.00" : `₹${rupees.toFixed(2)}`;
  } catch {
    return "₹0.00";
  }
}

function mapApiRow(row: AvailabilityApiRow): ItemAvailability {
  const id = row.menuItemId || (row as any).id || "";
  const name = row.name || "Dish";
  return {
    id,
    stockQty: typeof row.stockQty === "number" ? row.stockQty : (row.isStocked === false ? 0 : 1),
    isStocked: typeof row.isStocked === "boolean" ? row.isStocked : true,
    version: typeof row.version === "number" ? row.version : 1,
    category: row.categoryName || (row as any).category || "General",
    menuItem: {
      id,
      name,
      description: "",
      icon: row.isVeg ? "🥗" : "🍗",
      priceFormatted: formatPriceMinor(row.priceMinor),
      isVeg: row.isVeg ?? true,
    },
  };
}

type TabType = "AVAILABILITY" | "INGREDIENTS" | "RECIPES" | "PROCUREMENT";

export default function InventoryDashboard() {
  const { me, loading: authLoading } = useAuthGuard("menu.read");
  const [activeTab, setActiveTab] = useState<TabType>("AVAILABILITY");

  // Availability State
  const [items, setItems] = useState<ItemAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  // Ingredients State
  const [ingredients, setIngredients] = useState<RawIngredient[]>([]);
  const [loadingIng, setLoadingIng] = useState(false);
  const [showAddIngModal, setShowAddIngModal] = useState(false);
  const [newIngName, setNewIngName] = useState("");
  const [newIngUom, setNewIngUom] = useState("g");
  const [newIngReorder, setNewIngReorder] = useState("500");
  const [newIngUnitCost, setNewIngUnitCost] = useState("10");
  const [newIngStock, setNewIngStock] = useState("100");

  // Quick Stock Adjust State
  const [adjustModalIng, setAdjustModalIng] = useState<RawIngredient | null>(null);
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustType, setAdjustType] = useState<"ADD" | "DEDUCT">("ADD");

  // Recipes State
  const [recipes, setRecipes] = useState<RecipeApi[]>([]);
  const [loadingRec, setLoadingRec] = useState(false);
  const [showAddRecipeModal, setShowAddRecipeModal] = useState(false);
  const [selectedMenuItemId, setSelectedMenuItemId] = useState("");
  const [recipeLines, setRecipeLines] = useState<{ ingredientId: string; quantity: number; yieldPercent: number }[]>([
    { ingredientId: "", quantity: 100, yieldPercent: 100 },
  ]);

  // Vendors & PO State
  const [vendors, setVendors] = useState<VendorApi[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderApi[]>([]);
  const [showAddVendorModal, setShowAddVendorModal] = useState(false);
  const [newVendorName, setNewVendorName] = useState("");
  const [newVendorPhone, setNewVendorPhone] = useState("");
  const [newVendorEmail, setNewVendorEmail] = useState("");
  const [showAddPoModal, setShowAddPoModal] = useState(false);
  const [newPoVendorId, setNewPoVendorId] = useState("");
  const [newPoLines, setNewPoLines] = useState<{ ingredientId: string; quantity: number; unitPrice: number }[]>([
    { ingredientId: "", quantity: 10, unitPrice: 50 },
  ]);
  const [receivingPoId, setReceivingPoId] = useState<string | null>(null);

  const fetchAvailability = () => {
    setLoading(true);
    setLoadError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    authedFetch("/menu/availability", { signal: controller.signal })
      .then((res) => {
        clearTimeout(timeout);
        if (!res.ok) throw new Error("HTTP error " + res.status);
        return res.json();
      })
      .then((data: AvailabilityApiRow[]) => {
        setItems(Array.isArray(data) ? data.map(mapApiRow) : []);
        setLoading(false);
      })
      .catch((err) => {
        clearTimeout(timeout);
        setLoadError(err instanceof Error ? err.message : "Failed to load inventory");
        setItems([]);
        setLoading(false);
      });
  };

  const fetchIngredients = async () => {
    setLoadingIng(true);
    try {
      const res = await authedFetch("/inventory/ingredients");
      if (res.ok) {
        setIngredients(await res.json());
      }
    } catch (e) {
      console.error("Error fetching ingredients:", e);
    } finally {
      setLoadingIng(false);
    }
  };

  const fetchRecipes = async () => {
    setLoadingRec(true);
    try {
      const res = await authedFetch("/inventory/recipes");
      if (res.ok) {
        setRecipes(await res.json());
      }
    } catch (e) {
      console.error("Error fetching recipes:", e);
    } finally {
      setLoadingRec(false);
    }
  };

  const fetchVendorsAndPOs = async () => {
    try {
      const [vRes, poRes] = await Promise.all([
        authedFetch("/inventory/vendors"),
        authedFetch("/inventory/purchase-orders"),
      ]);
      if (vRes.ok) setVendors(await vRes.json());
      if (poRes.ok) setPurchaseOrders(await poRes.json());
    } catch (e) {
      console.error("Error fetching vendors and POs:", e);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    fetchAvailability();
    fetchIngredients();
    fetchRecipes();
    fetchVendorsAndPOs();
  }, [authLoading]);

  useKapmetaSocket(
    (payload) => {
      if (payload.topic === "inventory.stock_updated" || payload.topic === "finance.order_settled") {
        fetchIngredients();
        fetchAvailability();
        fetchVendorsAndPOs();
      }
    },
    !authLoading,
    "inventory"
  );

  const categories = useMemo(() => {
    const set = new Set(items.map((i) => i.category));
    return ["All", ...Array.from(set)];
  }, [items]);

  // Remaining stock on this tab should match BOM consumption. Orphan test SKUs
  // (created, never linked to an active recipe) stay hidden unless staff asks.
  const [showUnusedSkus, setShowUnusedSkus] = useState(false);
  const bomIngredientIds = useMemo(() => {
    const ids = new Set<string>();
    for (const rec of recipes) {
      if (rec.isActive === false) continue;
      for (const line of rec.recipeIngredients || []) {
        if (line.ingredientId) ids.add(line.ingredientId);
      }
    }
    return ids;
  }, [recipes]);
  const visibleIngredients = useMemo(
    () => (showUnusedSkus ? ingredients : ingredients.filter((ing) => bomIngredientIds.has(ing.id))),
    [ingredients, showUnusedSkus, bomIngredientIds]
  );
  const unusedSkuCount = ingredients.filter((ing) => !bomIngredientIds.has(ing.id)).length;

  const patchAvailability = async (id: string, isStocked: boolean, stockQty: number, expectedVersion: number) => {
    // Optimistically update local state immediately
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, isStocked, stockQty, version: expectedVersion + 1 } : it))
    );

    try {
      const res = await authedFetch(`/menu/items/${id}/availability`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isStocked, stockQty, expectedVersion }),
      });

      if (res.status === 409) {
        fetchAvailability();
        return;
      }
      if (!res.ok) throw new Error("HTTP error " + res.status);
      const data = await res.json();
      if (data && typeof data.newVersion === "number") {
        setItems((prev) =>
          prev.map((it) => (it.id === id ? { ...it, isStocked, stockQty, version: data.newVersion } : it))
        );
      }
    } catch (err) {
      console.error("Error patching availability:", err);
      fetchAvailability();
    }
  };

  const handleCreateIngredient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIngName.trim()) return;
    try {
      const res = await authedFetch("/inventory/ingredients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newIngName.trim(),
          unitOfMeasure: newIngUom,
          reorderLevel: parseFloat(newIngReorder) || 0,
          unitCost: parseFloat(newIngUnitCost) || 0,
          currentStock: parseFloat(newIngStock) || 0,
          initialStock: parseFloat(newIngStock) || 0,
        }),
      });
      if (res.ok) {
        setShowAddIngModal(false);
        setNewIngName("");
        setNewIngReorder("500");
        setNewIngUnitCost("10");
        setNewIngStock("100");
        await fetchIngredients();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create ingredient");
      }
    } catch (e) {
      alert("Failed to create ingredient");
    }
  };

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustModalIng) return;
    const amount = parseFloat(adjustQty);
    if (isNaN(amount) || amount <= 0) {
      alert("Please enter a valid positive quantity");
      return;
    }
    const delta = adjustType === "ADD" ? amount : -amount;
    try {
      const res = await authedFetch(`/inventory/ingredients/${adjustModalIng.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: delta }),
      });
      if (res.ok) {
        setAdjustModalIng(null);
        setAdjustQty("");
        await fetchIngredients();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to adjust stock");
      }
    } catch (e) {
      alert("Network error adjusting stock");
    }
  };

  const handleCreateRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMenuItemId) {
      alert("Please select a dish/menu item");
      return;
    }
    const validLines = recipeLines.filter((l) => l.ingredientId && l.quantity > 0);
    if (validLines.length === 0) {
      alert("Please add at least one valid ingredient line");
      return;
    }
    const selectedItem = items.find((i) => i.id === selectedMenuItemId);
    const dishName = selectedItem ? selectedItem.menuItem.name : "Recipe BOM";

    try {
      const res = await authedFetch("/inventory/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: dishName,
          menuItemId: selectedMenuItemId,
          ingredients: validLines,
        }),
      });
      if (res.ok) {
        setShowAddRecipeModal(false);
        setSelectedMenuItemId("");
        setRecipeLines([{ ingredientId: "", quantity: 100, yieldPercent: 100 }]);
        await fetchRecipes();
        alert("Recipe BOM linked successfully!");
      } else {
        const err = await res.json();
        alert(err.error || "Failed to link recipe BOM");
      }
    } catch (e) {
      alert("Failed to link recipe BOM");
    }
  };

  const handleCreateVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVendorName.trim() || !newVendorPhone.trim()) return;
    try {
      const res = await authedFetch("/inventory/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newVendorName.trim(),
          phone: newVendorPhone.trim(),
          email: newVendorEmail.trim() || undefined,
        }),
      });
      if (res.ok) {
        setShowAddVendorModal(false);
        setNewVendorName("");
        setNewVendorPhone("");
        setNewVendorEmail("");
        await fetchVendorsAndPOs();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create vendor");
      }
    } catch (e) {
      alert("Failed to create vendor");
    }
  };

  const handleCreatePO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPoVendorId) {
      alert("Please select a supplier / vendor");
      return;
    }
    const validLines = newPoLines.filter((l) => l.ingredientId && l.quantity > 0);
    if (validLines.length === 0) {
      alert("Please add at least one valid raw ingredient line item");
      return;
    }
    try {
      const res = await authedFetch("/inventory/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: newPoVendorId,
          items: validLines,
        }),
      });
      if (res.ok) {
        setShowAddPoModal(false);
        setNewPoVendorId("");
        setNewPoLines([{ ingredientId: "", quantity: 10, unitPrice: 50 }]);
        await fetchVendorsAndPOs();
        alert("✅ Purchase Order created successfully in DRAFT state!");
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create Purchase Order");
      }
    } catch (e) {
      alert("Failed to create Purchase Order");
    }
  };

  const handleReceivePO = async (poId: string) => {
    if (!confirm("Receive physical goods for this PO? Raw material stock will be automatically incremented in the database.")) return;
    setReceivingPoId(poId);
    try {
      const res = await authedFetch(`/inventory/purchase-orders/${poId}/receive`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        alert(`✅ ${data.message || "Goods received and stock incremented!"}`);
        await Promise.all([fetchVendorsAndPOs(), fetchIngredients()]);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to receive PO");
      }
    } catch (e) {
      alert("Network error receiving PO");
    } finally {
      setReceivingPoId(null);
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesSearch = item.menuItem.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory === "All" || item.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [items, searchQuery, selectedCategory]);

  const handleExport86 = () => {
    const listToExport = filteredItems;
    if (listToExport.length === 0) {
      alert("No dishes found to export.");
      return;
    }
    const lines = ["Dish Name,Category,Price,Status"];
    for (const it of listToExport) {
      const statusText = it.isStocked ? "IN_STOCK" : "86_OUT_OF_STOCK";
      lines.push(`"${it.menuItem.name}","${it.category}","${it.menuItem.priceFormatted}","${statusText}"`);
    }
    const csvContent = lines.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `86_availability_${selectedCategory.toLowerCase()}_${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
  };

  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-100 font-sans">
      <Head>
        <title>Inventory & Supply Chain - PetPooja POS</title>
      </Head>
      <Nav variant="sidebar" />

      <div className="flex-1 flex flex-col min-w-0 p-6 overflow-y-auto">
        {/* Top Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6 border-b border-slate-800 pb-4">
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Inventory & Recipe BOM</h1>
            <p className="text-xs text-slate-400 mt-1">
              Automated Recipe Depletion, 86 Item Availability, Raw Materials & Procurement
            </p>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center bg-slate-900 border border-slate-800 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab("AVAILABILITY")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                activeTab === "AVAILABILITY" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"
              }`}
            >
              📦 86 Availability
            </button>
            <button
              onClick={() => setActiveTab("INGREDIENTS")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                activeTab === "INGREDIENTS" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"
              }`}
            >
              🧂 Raw Ingredients ({ingredients.length})
            </button>
            <button
              onClick={() => setActiveTab("RECIPES")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                activeTab === "RECIPES" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"
              }`}
            >
              📜 Recipe BOM ({recipes.length})
            </button>
            <button
              onClick={() => setActiveTab("PROCUREMENT")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                activeTab === "PROCUREMENT" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"
              }`}
            >
              🚚 Vendors & POs ({vendors.length})
            </button>
          </div>
        </div>

        {/* TAB 1: AVAILABILITY & 86 LIST */}
        {activeTab === "AVAILABILITY" && (
          <div className="flex flex-col gap-4">
            {/* Filter Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-3 rounded-xl">
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <span className="text-slate-500 text-sm">🔍</span>
                <input
                  type="text"
                  placeholder="Search dishes to toggle 86 status..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 flex-1 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center gap-2 overflow-x-auto">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                      selectedCategory === cat ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400 hover:text-white"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <button
                onClick={handleExport86}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5"
                title="Export filtered items to CSV / Excel sheet"
              >
                <span>📥</span> Export 86 Sheet (CSV)
              </button>
            </div>

            {/* Dishes Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  className={`bg-slate-900 border rounded-xl p-4 flex flex-col justify-between transition ${
                    item.isStocked ? "border-slate-800" : "border-rose-900/40 bg-rose-950/10"
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs">{item.menuItem.isVeg ? "🟢" : "🔴"}</span>
                        <h3 className="font-bold text-sm text-slate-100">{item.menuItem.name}</h3>
                      </div>
                      <span className="text-[10px] text-slate-400">{item.category} • {item.menuItem.priceFormatted}</span>
                    </div>

                    <button
                      onClick={() => patchAvailability(item.id, !item.isStocked, item.stockQty, item.version)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition ${
                        item.isStocked
                          ? "bg-emerald-950 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-900"
                          : "bg-rose-950 text-rose-400 border border-rose-500/30 hover:bg-rose-900"
                      }`}
                    >
                      {item.isStocked ? "In Stock" : "86'd (Out)"}
                    </button>
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-800 pt-3 mt-2">
                    <span className="text-xs text-slate-400">POS / channel 86</span>
                    <span className={`text-[10px] font-bold uppercase ${item.isStocked ? "text-emerald-400" : "text-rose-400"}`}>
                      {item.isStocked ? "Sellable" : "86'd off"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: RAW INGREDIENTS */}
        {activeTab === "INGREDIENTS" && (
          <div className="flex flex-col gap-4">
            <div className="flex justify-between items-center bg-slate-900 border border-slate-800 p-3 rounded-xl">
              <div>
                <h2 className="text-sm font-bold text-slate-100">Raw Material Inventory</h2>
                <p className="text-[11px] text-slate-400">
                  Stock for ingredients on an active recipe BOM
                  {unusedSkuCount > 0 ? ` · ${unusedSkuCount} unused SKU${unusedSkuCount === 1 ? "" : "s"} hidden` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {unusedSkuCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowUnusedSkus((v) => !v)}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold transition"
                  >
                    {showUnusedSkus ? "Hide unused SKUs" : "Show unused SKUs"}
                  </button>
                )}
                <button
                  onClick={() => setShowAddIngModal(true)}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5"
                >
                  <span>+</span> Add Raw Material
                </button>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-bold uppercase text-[10px]">
                  <tr>
                    <th className="p-3">Ingredient Name</th>
                    <th className="p-3">Unit</th>
                    <th className="p-3">Unit Cost (₹)</th>
                    <th className="p-3">Reorder Threshold</th>
                    <th className="p-3">Current Stock</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {visibleIngredients.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-slate-500">
                        {ingredients.length === 0
                          ? "No raw ingredients configured. Click \"+ Add Raw Material\" above."
                          : "No ingredients are linked to an active recipe. Show unused SKUs or add a BOM."}
                      </td>
                    </tr>
                  ) : (
                    visibleIngredients.map((ing) => {
                      const isLow = ing.currentStock <= ing.reorderLevel;
                      return (
                        <tr key={ing.id} className="hover:bg-slate-800/40 transition">
                          <td className="p-3 font-semibold text-slate-100">{ing.name}</td>
                          <td className="p-3">{ing.unitOfMeasure}</td>
                          <td className="p-3">₹{ing.unitCost.toFixed(2)}</td>
                          <td className="p-3">{ing.reorderLevel} {ing.unitOfMeasure}</td>
                          <td className="p-3 font-bold text-slate-100">{ing.currentStock} {ing.unitOfMeasure}</td>
                          <td className="p-3">
                            {isLow ? (
                              <span className="bg-amber-950 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded text-[10px] font-bold">
                                ⚠️ Low Stock
                              </span>
                            ) : (
                              <span className="bg-emerald-950 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded text-[10px] font-bold">
                                Healthy
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            <button
                              onClick={() => {
                                setAdjustModalIng(ing);
                                setAdjustQty("10");
                                setAdjustType("ADD");
                              }}
                              className="bg-slate-800 hover:bg-slate-700 text-indigo-400 border border-slate-700 px-2.5 py-1 rounded-lg text-[10px] font-bold transition"
                            >
                              ± Adjust Stock
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: RECIPE BOM */}
        {activeTab === "RECIPES" && (
          <div className="flex flex-col gap-4">
            <div className="flex justify-between items-center bg-slate-900 border border-slate-800 p-3 rounded-xl">
              <div>
                <h2 className="text-sm font-bold text-slate-100">Recipe Bill of Materials (BOM)</h2>
                <p className="text-[11px] text-slate-400">Map menu dishes to raw ingredients for automatic depletion on KOT firing</p>
              </div>
              <button
                onClick={() => setShowAddRecipeModal(true)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5"
              >
                <span>+</span> Link Recipe to Dish
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {recipes.length === 0 ? (
                <div className="col-span-full bg-slate-900 border border-slate-800 p-8 rounded-xl text-center text-slate-500">
                  No recipes configured yet. Click "+ Link Recipe to Dish" to create your first recipe BOM.
                </div>
              ) : (
                recipes.map((rec) => (
                  <div key={rec.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
                        <span className="font-bold text-sm text-slate-100">{rec.menuItem?.name || "Dish"}</span>
                        <span className="text-[10px] bg-indigo-950 text-indigo-400 border border-indigo-500/30 px-1.5 py-0.5 rounded font-bold">
                          BOM v{rec.version}
                        </span>
                      </div>

                      <div className="flex flex-col gap-1.5 mb-3">
                        {(rec.recipeIngredients || (rec as any).ingredients || []).map((ri: any) => (
                          <div key={ri.id || ri.ingredientId} className="flex justify-between text-xs text-slate-300">
                            <span>{ri.ingredient?.name || ri.ingredientName || "Ingredient"}</span>
                            <span className="font-bold text-indigo-400">
                              {ri.quantity} {ri.ingredient?.unitOfMeasure || ri.unit || "g"} ({ri.yieldPercent || 100}%)
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="border-t border-slate-800 pt-2 text-[10px] text-slate-500 flex justify-between">
                      <span>Status: Active</span>
                      <span className="text-emerald-400 font-bold">● Auto-depletes on KOT</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 4: VENDORS & PROCUREMENT */}
        {activeTab === "PROCUREMENT" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap justify-between items-center bg-slate-900 border border-slate-800 p-3 rounded-xl gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-100">Vendors & Purchase Orders (Procurement)</h2>
                <p className="text-[11px] text-slate-400">Manage supplier directories, create POs, and receive stock via Goods Received Notes (GRN)</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAddVendorModal(true)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5"
                >
                  <span>+</span> Register Vendor
                </button>
                <button
                  onClick={() => setShowAddPoModal(true)}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5"
                >
                  <span>+</span> Create Purchase Order (PO)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Vendor List */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400 mb-3 flex justify-between items-center">
                  <span>Registered Suppliers</span>
                  <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-300">{vendors.length}</span>
                </h3>
                <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
                  {vendors.length === 0 ? (
                    <p className="text-xs text-slate-500 p-4 text-center">No suppliers registered. Click "+ Register Vendor" above.</p>
                  ) : (
                    vendors.map((v) => (
                      <div key={v.id} className="bg-slate-950 p-3 rounded-lg border border-slate-800/80 flex justify-between items-center">
                        <div>
                          <div className="font-bold text-xs text-slate-200">{v.name}</div>
                          <div className="text-[11px] text-slate-400">{v.phone} {v.email ? `• ${v.email}` : ""}</div>
                        </div>
                        <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-bold">Supplier</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Purchase Orders List */}
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-4">
                <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400 mb-3 flex justify-between items-center">
                  <span>Purchase Orders & Goods Receipt (GRN)</span>
                  <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-300">{purchaseOrders.length} POs</span>
                </h3>
                <div className="flex flex-col gap-3 max-h-[500px] overflow-y-auto">
                  {purchaseOrders.length === 0 ? (
                    <div className="bg-slate-950 p-8 rounded-lg text-center text-slate-500 text-xs">
                      No purchase orders recorded yet. Click "+ Create Purchase Order (PO)" above to create your first order.
                    </div>
                  ) : (
                    purchaseOrders.map((po) => {
                      const lines = po.items || [];
                      const isReceived = lines.length > 0 && lines.every((it: any) => Number(it.receivedQty || 0) >= Number(it.quantity || 0));
                      const receivedSome = lines.some((it: any) => Number(it.receivedQty || 0) > 0);
                      const displayStatus = isReceived
                        ? "RECEIVED"
                        : receivedSome
                          ? "PARTIALLY_RECEIVED"
                          : po.status === "RECEIVED"
                            ? "PENDING"
                            : po.status;
                      return (
                        <div key={po.id} className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex flex-col gap-3">
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm text-slate-100">{po.poNumber}</span>
                                <span className={`text-[10px] px-2 py-0.5 rounded font-bold border ${
                                  isReceived 
                                    ? "bg-emerald-950 text-emerald-400 border-emerald-500/30" 
                                    : "bg-indigo-950 text-indigo-400 border-indigo-500/30"
                                }`}>
                                  {displayStatus}
                                </span>
                              </div>
                              <p className="text-xs text-slate-400 mt-0.5">Supplier: <strong>{(po as any).vendorName || po.vendor?.name || "Vendor"}</strong> • {new Date(po.createdAt).toLocaleDateString()}</p>
                            </div>

                            <div className="text-right">
                              <span className="text-xs text-slate-400 block">Total Amount</span>
                              <span className="font-black text-sm text-emerald-400">₹{po.totalAmount.toFixed(2)}</span>
                            </div>
                          </div>

                          {/* Items summary */}
                          {po.items && po.items.length > 0 && (
                            <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60 flex flex-col gap-1 text-xs">
                              {po.items.map((it, idx) => (
                                <div key={idx} className="flex justify-between text-slate-300">
                                  <span>{it.quantity}x {(it as any).ingredientName || it.ingredient?.name || "Raw Material"} {typeof (it as any).receivedQty === "number" ? `(recv ${(it as any).receivedQty})` : ""}</span>
                                  <span className="font-mono text-slate-400">@ ₹{(it as any).unitPrice || it.unitCost} = ₹{((it as any).total || it.totalCost || (it.quantity * ((it as any).unitPrice || it.unitCost || 0))).toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="flex justify-between items-center pt-2 border-t border-slate-800/80">
                            <span className="text-[11px] text-slate-500">
                              {isReceived ? "Stock updated and verified via GRN" : "Physical shipment pending receipt"}
                            </span>

                            {!isReceived ? (
                              <button
                                onClick={() => handleReceivePO(po.id)}
                                disabled={receivingPoId === po.id}
                                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-sm"
                              >
                                <span>📥</span> {receivingPoId === po.id ? "Receiving..." : "Receive Goods (GRN)"}
                              </button>
                            ) : (
                              <span className="text-emerald-400 font-bold text-xs flex items-center gap-1">
                                <span>✅</span> Goods Received & Stock Incremented
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL: ADD RAW MATERIAL */}
      {showAddIngModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowAddIngModal(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-base text-slate-100 mb-4">Add Raw Material Ingredient</h2>
            <form onSubmit={handleCreateIngredient} className="flex flex-col gap-3">
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase">Ingredient Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rice Batter, Pure Ghee, Paneer"
                  value={newIngName}
                  onChange={(e) => setNewIngName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 font-bold uppercase">Unit of Measure</label>
                  <select
                    value={newIngUom}
                    onChange={(e) => setNewIngUom(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white mt-1"
                  >
                    <option value="g">Grams (g)</option>
                    <option value="kg">Kilograms (kg)</option>
                    <option value="ml">Milliliters (ml)</option>
                    <option value="L">Liters (L)</option>
                    <option value="pcs">Pieces (pcs)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 font-bold uppercase">Unit Cost (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newIngUnitCost}
                    onChange={(e) => setNewIngUnitCost(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white mt-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 font-bold uppercase">Initial Stock</label>
                  <input
                    type="number"
                    value={newIngStock}
                    onChange={(e) => setNewIngStock(e.target.value)}
                    placeholder="e.g. 100"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white mt-1"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 font-bold uppercase">Reorder Alert Threshold</label>
                  <input
                    type="number"
                    value={newIngReorder}
                    onChange={(e) => setNewIngReorder(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white mt-1"
                  />
                </div>
              </div>

              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => setShowAddIngModal(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded-lg text-xs font-bold"
                >
                  Save Ingredient
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADJUST STOCK */}
      {adjustModalIng && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setAdjustModalIng(null)}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-base text-slate-100 mb-1">Adjust Ingredient Stock</h2>
            <p className="text-xs text-slate-400 mb-4">{adjustModalIng.name} (Current: {adjustModalIng.currentStock} {adjustModalIng.unitOfMeasure})</p>

            <form onSubmit={handleAdjustStock} className="flex flex-col gap-3">
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase">Adjustment Type</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setAdjustType("ADD")}
                    className={`py-1.5 rounded-lg text-xs font-bold transition border ${
                      adjustType === "ADD"
                        ? "bg-emerald-950 text-emerald-300 border-emerald-500/50"
                        : "bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800"
                    }`}
                  >
                    + Add / Receive
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustType("DEDUCT")}
                    className={`py-1.5 rounded-lg text-xs font-bold transition border ${
                      adjustType === "DEDUCT"
                        ? "bg-rose-950 text-rose-300 border-rose-500/50"
                        : "bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800"
                    }`}
                  >
                    − Deduct / Wastage
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase">Quantity ({adjustModalIng.unitOfMeasure})</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="e.g. 10"
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white mt-1"
                />
              </div>

              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => setAdjustModalIng(null)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded-lg text-xs font-bold"
                >
                  Confirm Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: LINK RECIPE BOM */}
      {showAddRecipeModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowAddRecipeModal(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-base text-slate-100 mb-4">Link Recipe Bill of Materials (BOM)</h2>
            <form onSubmit={handleCreateRecipe} className="flex flex-col gap-3">
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase">Select Menu Dish</label>
                <select
                  required
                  value={selectedMenuItemId}
                  onChange={(e) => setSelectedMenuItemId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white mt-1"
                >
                  <option value="">-- Choose Menu Dish --</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.menuItem.name} ({it.category})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase mb-2 block">Ingredients Breakdown</label>
                <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                  {recipeLines.map((line, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-slate-950 p-2 rounded-lg border border-slate-800">
                      <select
                        value={line.ingredientId}
                        onChange={(e) => {
                          const val = e.target.value;
                          setRecipeLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ingredientId: val } : l)));
                        }}
                        className="flex-1 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="">-- Select Raw Item --</option>
                        {ingredients.map((ing) => (
                          <option key={ing.id} value={ing.id}>
                            {ing.name} ({ing.unitOfMeasure})
                          </option>
                        ))}
                      </select>

                      <input
                        type="number"
                        placeholder="Qty"
                        value={line.quantity}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setRecipeLines((prev) => prev.map((l, i) => (i === idx ? { ...l, quantity: val } : l)));
                        }}
                        className="w-20 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-white"
                      />

                      <button
                        type="button"
                        onClick={() => setRecipeLines((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-rose-400 hover:text-rose-300 px-1 font-bold text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setRecipeLines((prev) => [...prev, { ingredientId: "", quantity: 10, yieldPercent: 100 }])}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-bold mt-2 inline-block"
                >
                  + Add Ingredient Line
                </button>
              </div>

              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => setShowAddRecipeModal(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded-lg text-xs font-bold"
                >
                  Save Recipe BOM
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD VENDOR */}
      {showAddVendorModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowAddVendorModal(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-base text-slate-100 mb-4">Register Supplier / Vendor</h2>
            <form onSubmit={handleCreateVendor} className="flex flex-col gap-3">
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase">Supplier Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sri Lakshmi Dairy, Metro Cash & Carry"
                  value={newVendorName}
                  onChange={(e) => setNewVendorName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white mt-1"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase">Phone Number</label>
                <input
                  type="tel"
                  required
                  placeholder="e.g. +91 9876543210"
                  value={newVendorPhone}
                  onChange={(e) => setNewVendorPhone(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white mt-1"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase">Email (Optional)</label>
                <input
                  type="email"
                  placeholder="vendor@supplies.com"
                  value={newVendorEmail}
                  onChange={(e) => setNewVendorEmail(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white mt-1"
                />
              </div>

              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => setShowAddVendorModal(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded-lg text-xs font-bold"
                >
                  Register Vendor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CREATE PURCHASE ORDER (PO) */}
      {showAddPoModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowAddPoModal(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-base text-slate-100 mb-1">Create Purchase Order (PO)</h2>
            <p className="text-xs text-slate-400 mb-4">Select a supplier and add raw materials to order</p>

            <form onSubmit={handleCreatePO} className="flex flex-col gap-3">
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase">Select Supplier / Vendor</label>
                <select
                  required
                  value={newPoVendorId}
                  onChange={(e) => setNewPoVendorId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white mt-1"
                >
                  <option value="">-- Choose Registered Vendor --</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.phone})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase mb-2 block">Order Line Items</label>
                <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                  {newPoLines.map((line, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-slate-950 p-2 rounded-lg border border-slate-800">
                      <select
                        value={line.ingredientId}
                        onChange={(e) => {
                          const val = e.target.value;
                          const chosen = ingredients.find((ing) => ing.id === val);
                          setNewPoLines((prev) =>
                            prev.map((l, i) =>
                              i === idx
                                ? { ...l, ingredientId: val, unitPrice: chosen?.unitCost || l.unitPrice }
                                : l
                            )
                          );
                        }}
                        className="flex-1 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="">-- Raw Material --</option>
                        {ingredients.map((ing) => (
                          <option key={ing.id} value={ing.id}>
                            {ing.name} ({ing.unitOfMeasure})
                          </option>
                        ))}
                      </select>

                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          placeholder="Qty"
                          value={line.quantity}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setNewPoLines((prev) => prev.map((l, i) => (i === idx ? { ...l, quantity: val } : l)));
                          }}
                          className="w-16 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-white text-right"
                        />
                        <span className="text-[10px] text-slate-400 font-mono">
                          {ingredients.find((ing) => ing.id === line.ingredientId)?.unitOfMeasure || "u"}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-slate-400">@₹</span>
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Cost"
                          value={line.unitPrice}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setNewPoLines((prev) => prev.map((l, i) => (i === idx ? { ...l, unitPrice: val } : l)));
                          }}
                          className="w-16 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-white text-right"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => setNewPoLines((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-rose-400 hover:text-rose-300 px-1 font-bold text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex justify-between items-center mt-2">
                  <button
                    type="button"
                    onClick={() =>
                      setNewPoLines((prev) => [...prev, { ingredientId: "", quantity: 10, unitPrice: 50 }])
                    }
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-bold"
                  >
                    + Add Item Line
                  </button>

                  <span className="text-xs font-bold text-slate-300">
                    Est. Total: <strong className="text-emerald-400">₹{newPoLines.reduce((sum, l) => sum + (l.quantity || 0) * (l.unitPrice || 0), 0).toFixed(2)}</strong>
                  </span>
                </div>
              </div>

              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => setShowAddPoModal(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded-lg text-xs font-bold"
                >
                  Create Purchase Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
