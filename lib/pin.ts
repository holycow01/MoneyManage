/**
 * Local-only PIN fallback for the lock screen.
 *
 * Stored as SHA-256(salt + ":" + pin) in SecureStore so the raw PIN never
 * touches disk. This is *device-local* only — the PIN is not synced or
 * reachable from your Supabase data. Losing the device with a forgotten
 * PIN is recovered by signing out + back in (which clears local state).
 */
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const PIN_HASH_KEY = "pulse.pinHash";
const PIN_SALT_KEY = "pulse.pinSalt";

async function hashPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${salt}:${pin}`,
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hasPin(): Promise<boolean> {
  const v = await SecureStore.getItemAsync(PIN_HASH_KEY);
  return Boolean(v);
}

export async function setPin(pin: string): Promise<void> {
  if (!/^\d{4,6}$/.test(pin)) {
    throw new Error("PIN must be 4–6 digits.");
  }
  const salt = bytesToHex(await Crypto.getRandomBytesAsync(16));
  const hash = await hashPin(pin, salt);
  await SecureStore.setItemAsync(PIN_SALT_KEY, salt);
  await SecureStore.setItemAsync(PIN_HASH_KEY, hash);
}

export async function verifyPin(pin: string): Promise<boolean> {
  const [salt, stored] = await Promise.all([
    SecureStore.getItemAsync(PIN_SALT_KEY),
    SecureStore.getItemAsync(PIN_HASH_KEY),
  ]);
  if (!salt || !stored) return false;
  const candidate = await hashPin(pin, salt);
  return candidate === stored;
}

export async function clearPin(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_HASH_KEY);
  await SecureStore.deleteItemAsync(PIN_SALT_KEY);
}
