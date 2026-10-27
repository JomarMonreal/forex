// Shared by server and client code, so keep this file free of Node imports.

/**
 * Plain-language verdict from the out-of-sample results.
 * - edge:    clearly beats coin-flip and the "usual direction" baseline, and survives entering a bar late
 * - small:   beats both by a little and survives a late entry
 * - fragile: beats them only when entering exactly at the signal bar
 * - none:    no better than the baselines
 */
export type Verdict = "edge" | "small" | "fragile" | "none";

export function verdictFor(accuracy: number, baseline: number, delayed: number): Verdict {
  const bar = Math.max(0.5, baseline) + 0.015;
  if (accuracy < bar) return "none";
  if (delayed < 0.51) return "fragile";
  return accuracy >= 0.55 && delayed >= 0.53 ? "edge" : "small";
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  edge: "Proven edge",
  small: "Small edge",
  fragile: "Fragile edge",
  none: "No proven edge",
};
