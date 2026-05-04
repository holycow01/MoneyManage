/**
 * Resolve a kebab-case lucide name (e.g. "shopping-bag") to the matching
 * lucide-react-native component. Falls back to <Circle/> if not found so
 * the UI never crashes on a typo'd icon.
 */
import * as Lucide from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";

const cache = new Map<string, LucideIcon>();

export function getLucideIcon(name: string | null | undefined): LucideIcon {
  if (!name) return Lucide.Circle;
  if (cache.has(name)) return cache.get(name)!;

  const pascal = name
    .split("-")
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");

  const Icon = (Lucide as unknown as Record<string, LucideIcon>)[pascal];
  const resolved = Icon ?? Lucide.Circle;
  cache.set(name, resolved);
  return resolved;
}
