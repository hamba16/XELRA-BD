import type { Division, Profile } from "../data";

export const marker = "__XELRA_DEV_SWITCHER__";
const validDivisions = new Set<string>(["ENG", "AMG", "COR"]);
const validPrincipals = [
  "staff",
  "client",
  "contractor",
  "auditor",
  "it_admin",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadDevProfiles(): Profile[] {
  const raw = import.meta.env.VITE_DEV_PROFILES;
  if (!raw)
    throw Error(
      "Set VITE_DEV_PROFILES to a JSON array in .env.development.local.",
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw Error("VITE_DEV_PROFILES must contain valid JSON.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0)
    throw Error("VITE_DEV_PROFILES must be a non-empty JSON array.");
  const ids = new Set<string>();
  return parsed.map((entry, index) => {
    if (!isObject(entry))
      throw Error(`Development profile ${index + 1} must be an object.`);
    const { id, name, principal, permissions, divisions } = entry;
    const normalizedId = typeof id === "string" ? id.trim() : "";
    if (!normalizedId || ids.has(normalizedId))
      throw Error(
        `Development profile ${index + 1} needs a unique non-empty id.`,
      );
    if (typeof name !== "string" || !name.trim())
      throw Error(`Development profile ${index + 1} needs a name.`);
    if (typeof principal !== "string" || !validPrincipals.includes(principal))
      throw Error(
        `Development profile ${index + 1} has an unsupported principal.`,
      );
    if (
      !Array.isArray(permissions) ||
      !permissions.every((item) => typeof item === "string")
    )
      throw Error(
        `Development profile ${index + 1} permissions must be strings.`,
      );
    if (
      !Array.isArray(divisions) ||
      !divisions.every(
        (item): item is Division =>
          typeof item === "string" && validDivisions.has(item),
      )
    )
      throw Error(
        `Development profile ${index + 1} divisions must be ENG, AMG, or COR.`,
      );
    ids.add(normalizedId);
    return {
      id: normalizedId,
      name: name.trim(),
      principal,
      permissions: [...permissions],
      divisions: [...divisions],
    };
  });
}
