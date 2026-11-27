export type FinanceChartStyle = "columns" | "line" | "area";
export interface WorkspacePreferences {
  theme: "light" | "dark";
  financeChartStyle: FinanceChartStyle;
}

export const defaultWorkspacePreferences: WorkspacePreferences = {
  theme: "light",
  financeChartStyle: "columns",
};

export function preferenceStorageKey(profileId: string): string {
  return `xelra-workspace-preferences:v1:${profileId}`;
}

export function readWorkspacePreferences(profileId: string): WorkspacePreferences {
  const raw = localStorage.getItem(preferenceStorageKey(profileId));
  if (raw === null) return defaultWorkspacePreferences;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw Error("Saved workspace preferences could not be read.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw Error("Saved workspace preferences have an invalid format.");
  const saved = value as Record<string, unknown>;
  if ((saved.theme !== "light" && saved.theme !== "dark") ||
    (saved.financeChartStyle !== "columns" && saved.financeChartStyle !== "line" && saved.financeChartStyle !== "area"))
    throw Error("Saved workspace preferences contain an unsupported option.");
  return { theme: saved.theme, financeChartStyle: saved.financeChartStyle };
}

export function writeWorkspacePreferences(profileId: string, preferences: WorkspacePreferences): void {
  localStorage.setItem(preferenceStorageKey(profileId), JSON.stringify(preferences));
}
