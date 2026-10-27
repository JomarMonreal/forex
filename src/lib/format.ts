export const priceDigits = (price: number) => (price >= 100 ? 3 : price >= 10 ? 4 : 5);

export const fmtPrice = (price: number | null | undefined) =>
  price == null || !isFinite(price) ? "—" : price.toFixed(priceDigits(price));

export const fmtPct = (v: number, digits = 2) => `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;

export function timeAgo(ms: number) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
