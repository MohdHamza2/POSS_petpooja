import { businessDayWindow, currentBusinessDayWindow, type BusinessDayWindow } from "@kapmeta/finance";
import { prisma } from "./prisma";

export async function outletBusinessDayWindow(
  outletId: string,
  dateParam?: string | Date | null,
): Promise<BusinessDayWindow> {
  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    select: { dayStartTime: true },
  });
  if (dateParam) {
    return businessDayWindow(outlet?.dayStartTime, dateParam);
  }
  return currentBusinessDayWindow(outlet?.dayStartTime);
}
