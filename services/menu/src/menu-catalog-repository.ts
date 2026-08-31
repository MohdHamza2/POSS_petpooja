// @ts-nocheck
import { PrismaClient } from "@prisma/client";
import type { MenuCategoryInput, MenuItemInput, MenuItemView } from "@kapmeta/shared-types/menu";

export class PrismaMenuCatalogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createCategory(input: MenuCategoryInput) {
    return this.prisma.menuCategory.create({
      data: {
        outletId: input.outletId,
        name: input.name,
        description: input.description,
      },
    });
  }

  async createMenuItem(input: MenuItemInput) {
    const priceDecimal = (Number(input.priceMinor || 0) / 100).toFixed(2);
    const taxDecimal = input.taxRate !== undefined ? Number(input.taxRate).toFixed(2) : "5.00";

    const created = await this.prisma.menuItem.create({
      data: {
        outletId: input.outletId,
        categoryId: input.categoryId,
        name: input.name,
        description: input.description,
        price: priceDecimal as any,
        isVeg: input.isVeg !== undefined ? input.isVeg : true,
        taxRate: taxDecimal as any,
      },
    });

    return {
      id: created.id,
      outletId: created.outletId,
      categoryId: created.categoryId,
      name: created.name,
      description: created.description,
      priceMinor: input.priceMinor,
      price: priceDecimal,
      isVeg: created.isVeg,
      taxRate: (created.taxRate ?? 5.0).toString(),
      isActive: created.isActive,
    };
  }

  async createModifierGroup(outletId: string, name: string, minSelect: number, maxSelect: number) {
    return this.prisma.modifierGroup.create({
      data: { outletId, name, minSelect, maxSelect },
    });
  }

  async createModifierOption(outletId: string, modifierGroupId: string, name: string, priceMinor: bigint) {
    return this.prisma.modifiers.create({
      data: {
        outlet_id: outletId,
        group_id: modifierGroupId,
        name,
        price_delta_minor: priceMinor,
      },
    });
  }

  async linkModifierToItem(outletId: string, menuItemId: string, modifierGroupId: string) {
    return this.prisma.item_modifier_groups.create({
      data: { outlet_id: outletId, item_id: menuItemId, group_id: modifierGroupId },
    });
  }

  async listCategories(outletId: string) {
    return this.prisma.menuCategory.findMany({
      where: { outletId, isActive: true },
      orderBy: { sortOrder: "asc" },
    });
  }

  async listAllItems(outletId: string): Promise<MenuItemView[]> {
    const rows = await this.prisma.menuItem.findMany({
      where: { outletId, isActive: true },
      include: { category: true },
      orderBy: { name: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      outletId: row.outletId,
      categoryId: row.categoryId,
      categoryName: row.category?.name ?? "General",
      name: row.name,
      description: row.description,
      priceMinor: BigInt(Math.round(Number(row.price || 0) * 100)),
      isVeg: row.isVeg,
      taxRate: (row.taxRate ?? 5.0).toString(),
      isActive: row.isActive,
      availability: {
        isStocked: true,
        stockQty: 100,
        version: 1,
      },
    }));
  }

  async listByCategory(categoryId: string): Promise<MenuItemView[]> {
    const rows = await this.prisma.menuItem.findMany({
      where: { categoryId },
      include: { category: true },
    });
    return rows.map((row) => ({
      id: row.id,
      outletId: row.outletId,
      categoryId: row.categoryId,
      categoryName: row.category?.name ?? "General",
      name: row.name,
      description: row.description,
      priceMinor: BigInt(Math.round(Number(row.price || 0) * 100)),
      isVeg: row.isVeg,
      taxRate: (row.taxRate ?? 5.0).toString(),
      isActive: row.isActive,
      availability: {
        isStocked: true,
        stockQty: 100,
        version: 1,
      },
    }));
  }
}
