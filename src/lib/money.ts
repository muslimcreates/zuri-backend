// Prices are stored as integer kuruş (1 TRY = 100 kuruş) to avoid float
// rounding bugs in a checkout flow. These helpers convert at the edges.

export function kurusToTRY(kurus: number): number {
  return kurus / 100;
}

export function tryToKurus(tryAmount: number): number {
  return Math.round(tryAmount * 100);
}

export function formatTRY(kurus: number): string {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(kurusToTRY(kurus));
}
