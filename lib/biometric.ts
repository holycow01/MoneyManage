/**
 * Biometric (+ session-timeout) helpers.
 *
 * Lock policy:
 *   - On cold start, the app is always locked.
 *   - When the app returns to foreground after >LOCK_TIMEOUT_MS in the
 *     background, it locks again.
 *   - Successful unlock writes a timestamp into SecureStore so that quick
 *     toggles (e.g. swipe to home and back in 5s) don't re-prompt.
 */
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

import { usePreferencesStore } from "@/stores/preferencesStore";

/** Default lock timeout — used until the preferences store has hydrated. */
export const LOCK_TIMEOUT_MS = 60 * 1000;
const LAST_UNLOCK_KEY = "pulse.lastUnlockedAt";

/** The user-configurable lock timeout in milliseconds. */
export function getLockTimeoutMs(): number {
  const minutes = usePreferencesStore.getState().autoLockMinutes;
  return minutes * 60 * 1000;
}

/** Does this device have a usable biometric (face/fingerprint) enrolled? */
export async function isBiometricAvailable(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) return false;
  return LocalAuthentication.isEnrolledAsync();
}

/** What kind of biometric is enrolled — used to label the unlock button. */
export async function getBiometricKind(): Promise<
  "face" | "fingerprint" | "iris" | "none"
> {
  if (!(await isBiometricAvailable())) return "none";
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION))
    return "face";
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT))
    return "fingerprint";
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return "iris";
  return "none";
}

/** Prompt the OS biometric sheet. Resolves true on success. */
export async function authenticateBiometric(): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock Pulse",
    fallbackLabel: "Use PIN",
    cancelLabel: "Cancel",
    disableDeviceFallback: true, // we manage our own PIN fallback
  });
  return result.success;
}

export async function getLastUnlockedAt(): Promise<number | null> {
  const v = await SecureStore.getItemAsync(LAST_UNLOCK_KEY);
  return v ? Number(v) : null;
}

export async function markUnlocked(): Promise<void> {
  await SecureStore.setItemAsync(LAST_UNLOCK_KEY, String(Date.now()));
}

export async function clearUnlockMark(): Promise<void> {
  await SecureStore.deleteItemAsync(LAST_UNLOCK_KEY);
}

/** True if the lock screen should be shown at app launch. */
export async function shouldLockOnLaunch(): Promise<boolean> {
  const last = await getLastUnlockedAt();
  if (!last) return true;
  return Date.now() - last > getLockTimeoutMs();
}
