/** Matches services/orders priceOrder inclusive GST (bigint integer division). */
export function extractInclusiveTaxMinor(subtotalMinor: number, taxRatePercent: number): number {
  const sub = Math.round(Number(subtotalMinor) || 0);
  const rate = Number(taxRatePercent);
  if (sub <= 0 || !Number.isFinite(rate) || rate <= 0) return 0;
  const basis = Math.round(rate * 100);
  return sub - Math.floor((sub * 10000) / (10000 + basis));
}
