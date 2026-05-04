/**
 * AppGate — single source of truth for "where should the user be right now?".
 *
 * Personal-mode flow (no auth):
 *   - On first launch (no accounts yet) → /(auth)/onboarding
 *   - Otherwise, after >N minutes in background → /(auth)/lock
 *   - Else → /(tabs)
 *
 * Notes:
 *   - The biometric lock screen is the only security layer. PIN fallback
 *     is configurable from Settings.
 *   - Re-export name kept as `AuthGate` so we don't have to touch every
 *     screen that imports it.
 */
import { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  View,
} from "react-native";
import { useRouter, useSegments } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import {
  getLockTimeoutMs,
  shouldLockOnLaunch,
} from "@/lib/biometric";
import { useLockStore } from "@/stores/lockStore";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const segments = useSegments();

  const isLocked = useLockStore((s) => s.isLocked);
  const isInitialized = useLockStore((s) => s.isInitialized);
  const setLocked = useLockStore((s) => s.setLocked);
  const setInitialized = useLockStore((s) => s.setInitialized);

  const backgroundedAt = useRef<number | null>(null);

  // First-run detection: zero accounts means the user hasn't completed
  // onboarding. We re-fetch on focus so finishing onboarding flips us
  // through to /(tabs) without a manual reload.
  const accountsCountQ = useQuery({
    queryKey: ["accounts", "count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("accounts")
        .select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  // ── 1. Initial lock check ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lock = await shouldLockOnLaunch();
      if (!cancelled) {
        setLocked(lock);
        setInitialized(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setLocked, setInitialized]);

  // ── 2. Re-lock after background timeout ────────────────────────────────
  useEffect(() => {
    const handler = (state: AppStateStatus) => {
      if (state === "background" || state === "inactive") {
        backgroundedAt.current = Date.now();
      } else if (state === "active") {
        const at = backgroundedAt.current;
        backgroundedAt.current = null;
        if (at && Date.now() - at > getLockTimeoutMs()) setLocked(true);
      }
    };
    const sub = AppState.addEventListener("change", handler);
    return () => sub.remove();
  }, [setLocked]);

  // ── 3. Routing ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isInitialized || accountsCountQ.isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";
    const onLock = inAuthGroup && segments[1] === "lock";
    const onOnboarding = inAuthGroup && segments[1] === "onboarding";

    const accountsCount = accountsCountQ.data ?? 0;

    // First run — no accounts yet.
    if (accountsCount === 0) {
      if (!onOnboarding) router.replace("/(auth)/onboarding");
      return;
    }

    // Locked → lock screen.
    if (isLocked) {
      if (!onLock) router.replace("/(auth)/lock");
      return;
    }

    // Otherwise, if we're sitting in /(auth) for any other reason, bounce
    // to the tabs.
    if (inAuthGroup) router.replace("/(tabs)");
  }, [
    isInitialized,
    isLocked,
    accountsCountQ.data,
    accountsCountQ.isLoading,
    segments,
    router,
  ]);

  if (!isInitialized || accountsCountQ.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#10b981" />
      </View>
    );
  }
  return <>{children}</>;
}
