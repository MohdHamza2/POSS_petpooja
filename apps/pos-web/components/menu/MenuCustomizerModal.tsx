import React, { useEffect, useState } from "react";
import { authedFetch } from "../../lib/auth";
import { MenuItemData } from "./AttractiveMenuItemCard";

export interface CustomizedItemSelection {
  portion: "REGULAR" | "HALF" | "FULL";
  portionMultiplier: number;
  spiceLevel: "MILD" | "MEDIUM" | "SPICY" | "EXTRA_HOT";
  addons: Array<{ id: string; name: string; priceMinor: number }>;
  specialInstructions: string;
  finalPriceMinor: number;
  modifierOptionIds: string[];
}

interface ModifierOption {
  id: string;
  name: string;
  priceMinor: number;
}

interface ModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: ModifierOption[];
}

interface MenuCustomizerModalProps {
  isOpen: boolean;
  item: MenuItemData | null;
  onClose: () => void;
  onConfirm: (item: MenuItemData, customization: CustomizedItemSelection) => void;
}

function isPortionGroup(name: string): boolean {
  const n = (name || "").toLowerCase();
  return n.includes("portion") || n.includes("size") || n.includes("half") || n.includes("full");
}

export default function MenuCustomizerModal({
  isOpen,
  item,
  onClose,
  onConfirm,
}: MenuCustomizerModalProps) {
  const [spiceLevel, setSpiceLevel] = useState<"MILD" | "MEDIUM" | "SPICY" | "EXTRA_HOT">("MEDIUM");
  const [notes, setNotes] = useState("");
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [portionOptionId, setPortionOptionId] = useState<string | null>(null);
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);

  useEffect(() => {
    if (!isOpen || !item) return;
    setSpiceLevel("MEDIUM");
    setNotes("");
    setPortionOptionId(null);
    setSelectedAddonIds([]);
    setGroups([]);
    let cancelled = false;
    setLoadingGroups(true);
    authedFetch(`/menu/items/${item.id}/modifiers`)
      .then(async (res) => {
        const data = res.ok ? await res.json() : [];
        if (cancelled) return;
        setGroups(Array.isArray(data) ? data : []);
        // #region agent log
        fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'D',location:'MenuCustomizerModal.tsx:load',message:'customizer loaded catalog modifiers',data:{menuItemId:item.id,groupCount:Array.isArray(data)?data.length:0,hardcodedAddons:false},timestamp:Date.now(),runId:'wave3'})}).catch(()=>{});
        // #endregion
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingGroups(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, item?.id]);

  if (!isOpen || !item) return null;

  const basePrice = Number(item.priceMinor);
  const portionGroups = groups.filter((g) => isPortionGroup(g.name));
  const addonGroups = groups.filter((g) => !isPortionGroup(g.name));
  const portionOptions = portionGroups.flatMap((g) => g.options);
  const addonOptions = addonGroups.flatMap((g) => g.options);

  const portionDelta = portionOptions.find((o) => o.id === portionOptionId)?.priceMinor || 0;
  const selectedAddons = addonOptions.filter((o) => selectedAddonIds.includes(o.id));
  const addonsTotalMinor = selectedAddons.reduce((sum, a) => sum + a.priceMinor, 0);
  const finalPriceMinor = basePrice + portionDelta + addonsTotalMinor;

  const toggleAddon = (option: ModifierOption, group: ModifierGroup) => {
    setSelectedAddonIds((prev) => {
      const exists = prev.includes(option.id);
      if (exists) return prev.filter((id) => id !== option.id);
      const groupOptionIds = new Set(group.options.map((o) => o.id));
      const selectedInGroup = prev.filter((id) => groupOptionIds.has(id));
      if (group.maxSelect > 0 && selectedInGroup.length >= group.maxSelect) {
        const withoutOldest = prev.filter((id) => id !== selectedInGroup[0]);
        return [...withoutOldest, option.id];
      }
      return [...prev, option.id];
    });
  };

  const handleApply = () => {
    const portionName = portionOptions.find((o) => o.id === portionOptionId)?.name || "Regular";
    const portionKey = /half/i.test(portionName) ? "HALF" : /full|large/i.test(portionName) ? "FULL" : "REGULAR";
    const spiceNote = `Spice: ${spiceLevel}`;
    const mergedNotes = notes.trim() ? `${spiceNote}. ${notes.trim()}` : spiceNote;
    onConfirm(item, {
      portion: portionKey,
      portionMultiplier: 1,
      spiceLevel,
      addons: selectedAddons.map((a) => ({ id: a.id, name: a.name, priceMinor: a.priceMinor })),
      specialInstructions: mergedNotes,
      finalPriceMinor,
      modifierOptionIds: [portionOptionId, ...selectedAddonIds].filter((id): id is string => Boolean(id)),
    });
    onClose();
  };

  return (
    <div className="customizer-backdrop" onClick={onClose}>
      <div className="customizer-card" onClick={(e) => e.stopPropagation()}>
        <div className="customizer-header">
          <div className="title-group">
            <div className="item-badge-title">
              <span className={`fssai-indicator ${item.isVeg ? "veg" : "non-veg"}`}>●</span>
              <h3 className="item-name-heading">{item.name}</h3>
            </div>
            <span className="base-price-tag">Base: ₹{(basePrice / 100).toFixed(2)}</span>
          </div>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        <div className="customizer-body-scroll">
          <div className="customizer-section">
            <label className="section-label">1. Choose Portion Size</label>
            <div className="portion-grid">
              <button
                type="button"
                className={`portion-chip ${portionOptionId === null ? "active" : ""}`}
                onClick={() => setPortionOptionId(null)}
              >
                <span>Regular (Standard)</span>
                <span className="portion-price">₹{(basePrice / 100).toFixed(0)}</span>
              </button>
              {portionOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`portion-chip ${portionOptionId === opt.id ? "active" : ""}`}
                  onClick={() => setPortionOptionId(opt.id)}
                >
                  <span>{opt.name}</span>
                  <span className="portion-price">
                    ₹{((basePrice + opt.priceMinor) / 100).toFixed(0)}
                  </span>
                </button>
              ))}
            </div>
            {portionOptions.length === 0 && !loadingGroups && (
              <div className="empty-mods">No portion variants in catalog. Regular price applies.</div>
            )}
          </div>

          <div className="customizer-section">
            <label className="section-label">2. Spice Level</label>
            <div className="spice-grid">
              {[
                { key: "MILD", label: "Mild 🟢" },
                { key: "MEDIUM", label: "Medium 🟡" },
                { key: "SPICY", label: "Spicy 🌶️" },
                { key: "EXTRA_HOT", label: "Extra Hot 🔥" },
              ].map((sp) => (
                <button
                  key={sp.key}
                  type="button"
                  className={`spice-chip ${spiceLevel === sp.key ? "active" : ""}`}
                  onClick={() => setSpiceLevel(sp.key as any)}
                >
                  {sp.label}
                </button>
              ))}
            </div>
          </div>

          <div className="customizer-section">
            <label className="section-label">3. Add-on Extras</label>
            {loadingGroups ? (
              <div className="empty-mods">Loading catalog extras…</div>
            ) : addonGroups.length === 0 ? (
              <div className="empty-mods">No add-ons linked to this item.</div>
            ) : (
              addonGroups.map((group) => (
                <div key={group.id} className="addons-list">
                  <div className="addon-group-name">{group.name}</div>
                  {group.options.map((addon) => {
                    const isChecked = selectedAddonIds.includes(addon.id);
                    return (
                      <div
                        key={addon.id}
                        className={`addon-row ${isChecked ? "active" : ""}`}
                        onClick={() => toggleAddon(addon, group)}
                      >
                        <div className="addon-info">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="addon-checkbox"
                          />
                          <span className="addon-name">{addon.name}</span>
                        </div>
                        <span className="addon-price">
                          {addon.priceMinor === 0 ? "Free" : `+₹${(addon.priceMinor / 100).toFixed(2)}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="customizer-section">
            <label className="section-label">4. Special Instructions (KOT Note)</label>
            <input
              type="text"
              placeholder="e.g. Crispy texture, less oil, separate chutney..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="notes-input"
            />
          </div>
        </div>

        <div className="customizer-footer">
          <div className="footer-total-box">
            <span className="footer-total-label">Customized Total:</span>
            <strong className="footer-total-price">₹{(finalPriceMinor / 100).toFixed(2)}</strong>
          </div>
          <button type="button" className="btn-confirm-add" onClick={handleApply}>
            Add Customized Item →
          </button>
        </div>
      </div>

      <style jsx>{`
        .customizer-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(15, 23, 42, 0.6);
          backdrop-filter: blur(4px);
          z-index: 400;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: inherit;
        }
        .customizer-card {
          background: #ffffff;
          border-radius: 16px;
          padding: 20px 24px;
          width: 90%;
          max-width: 520px;
          max-height: 90vh;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          display: flex;
          flex-direction: column;
        }
        .customizer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 12px;
        }
        .item-badge-title {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .fssai-indicator { font-size: 1.1rem; }
        .fssai-indicator.veg { color: #16a34a; }
        .fssai-indicator.non-veg { color: #dc2626; }
        .item-name-heading {
          margin: 0;
          font-size: 1.125rem;
          font-weight: 800;
          color: #0f172a;
        }
        .base-price-tag {
          font-size: 0.75rem;
          color: #64748b;
          font-weight: 600;
        }
        .btn-close {
          background: transparent;
          border: none;
          font-size: 1.2rem;
          color: #64748b;
          cursor: pointer;
        }
        .customizer-body-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 14px 0;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .customizer-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .section-label {
          font-size: 0.8125rem;
          font-weight: 800;
          color: #334155;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .empty-mods {
          font-size: 0.8rem;
          color: #94a3b8;
        }
        .addon-group-name {
          font-size: 0.75rem;
          font-weight: 700;
          color: #64748b;
          margin-top: 4px;
        }
        .portion-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
        }
        .portion-chip {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          padding: 8px;
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          font-size: 0.75rem;
          font-weight: 700;
          color: #334155;
          cursor: pointer;
        }
        .portion-chip.active {
          border-color: #2563eb;
          background: #eff6ff;
          color: #1e40af;
          box-shadow: 0 0 0 1px #2563eb;
        }
        .portion-price {
          font-size: 0.875rem;
          font-weight: 900;
          color: #0f172a;
        }
        .spice-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 6px;
        }
        .spice-chip {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          padding: 8px 4px;
          border-radius: 8px;
          font-size: 0.75rem;
          font-weight: 700;
          color: #334155;
          cursor: pointer;
          text-align: center;
        }
        .spice-chip.active {
          border-color: #f97316;
          background: #fff7ed;
          color: #c2410c;
          box-shadow: 0 0 0 1px #f97316;
        }
        .addons-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .addon-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.8125rem;
          transition: background 0.1s;
        }
        .addon-row.active {
          background: #f0fdf4;
          border-color: #86efac;
        }
        .addon-info {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .addon-name {
          font-weight: 600;
          color: #334155;
        }
        .addon-price {
          font-weight: 700;
          color: #0f172a;
        }
        .notes-input {
          padding: 10px 12px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          font-size: 0.8125rem;
          font-family: inherit;
        }
        .customizer-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-top: 1px solid #e2e8f0;
          padding-top: 14px;
        }
        .footer-total-box {
          display: flex;
          flex-direction: column;
        }
        .footer-total-label {
          font-size: 0.75rem;
          color: #64748b;
          font-weight: 600;
        }
        .footer-total-price {
          font-size: 1.25rem;
          font-weight: 900;
          color: #0f172a;
        }
        .btn-confirm-add {
          background: #2563eb;
          color: #ffffff;
          border: none;
          padding: 10px 20px;
          border-radius: 8px;
          font-weight: 800;
          font-size: 0.875rem;
          cursor: pointer;
          box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);
        }
      `}</style>
    </div>
  );
}
