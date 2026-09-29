// The window of the recent operations of the Overview: how far back its line of time goes. It is one
// preference of the extension, and not one for each cluster.
export const WINDOWS = ["24h", "7d", "30d"] as const;
export type Window = (typeof WINDOWS)[number];
export const DEFAULT_WINDOW: Window = "7d";

const HOUR = 3_600_000;

export const WINDOW_LENGTH: Record<Window, number> = { "24h": 24 * HOUR, "7d": 7 * 24 * HOUR, "30d": 30 * 24 * HOUR };
export const WINDOW_TITLES: Record<Window, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" };

// The window a stored value names, or the one that is taken when none was chosen.
export function readWindow(value: unknown): Window {
  return (WINDOWS as readonly unknown[]).includes(value) ? (value as Window) : DEFAULT_WINDOW;
}
