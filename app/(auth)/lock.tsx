import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Fingerprint, KeyRound, ScanFace } from "lucide-react-native";

import {
  authenticateBiometric,
  getBiometricKind,
  isBiometricAvailable,
  markUnlocked,
} from "@/lib/biometric";
import { hasPin, setPin, verifyPin } from "@/lib/pin";
import { useLockStore } from "@/stores/lockStore";

type Mode = "biometric" | "pin" | "setup";

export default function LockScreen() {
  const router = useRouter();
  const setLocked = useLockStore((s) => s.setLocked);

  const [mode, setMode] = useState<Mode>("biometric");
  const [bioKind, setBioKind] = useState<"face" | "fingerprint" | "iris" | "none">(
    "none",
  );
  const [pinInput, setPinInput] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoTriedRef = useRef(false);

  const unlock = useCallback(async () => {
    await markUnlocked();
    setLocked(false);
    router.replace("/(tabs)");
  }, [router, setLocked]);

  const tryBiometric = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const ok = await authenticateBiometric();
      if (ok) return unlock();

      // Failed/cancelled → show PIN entry (or setup if none yet).
      const pinSet = await hasPin();
      setMode(pinSet ? "pin" : "setup");
    } finally {
      setBusy(false);
    }
  }, [unlock]);

  // Decide initial UI mode and (if available) auto-prompt biometric once.
  useEffect(() => {
    (async () => {
      const bioOk = await isBiometricAvailable();
      const kind = await getBiometricKind();
      const pinSet = await hasPin();
      setBioKind(kind);

      if (bioOk) {
        setMode("biometric");
        if (!autoTriedRef.current) {
          autoTriedRef.current = true;
          // small delay so the screen renders before the OS sheet appears
          setTimeout(tryBiometric, 200);
        }
      } else if (pinSet) {
        setMode("pin");
      } else {
        setMode("setup");
      }
    })();
  }, [tryBiometric]);

  const onPinSubmit = useCallback(async () => {
    setError(null);
    if (mode === "setup") {
      if (!/^\d{4,6}$/.test(pinInput)) {
        setError("PIN must be 4–6 digits.");
        return;
      }
      if (pinInput !== pinConfirm) {
        setError("PINs do not match.");
        return;
      }
      setBusy(true);
      try {
        await setPin(pinInput);
        await unlock();
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      const ok = await verifyPin(pinInput);
      if (ok) return unlock();
      setError("Incorrect PIN.");
      setPinInput("");
    } finally {
      setBusy(false);
    }
  }, [mode, pinInput, pinConfirm, unlock]);

  const BiometricIcon = bioKind === "face" ? ScanFace : Fingerprint;
  const showingPinForm = mode === "pin" || mode === "setup";

  const titleByMode: Record<Mode, string> = {
    biometric: "Pulse is locked",
    pin: "Enter PIN",
    setup: "Set up a PIN",
  };
  const subtitleByMode: Record<Mode, string> = {
    biometric: "Authenticate to view your finances.",
    pin: "Use your PIN to unlock.",
    setup: "Used when biometrics aren’t available.",
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-background"
    >
      <View className="flex-1 items-center justify-center px-6">
        <View
          className="w-full max-w-sm items-center rounded-2xl border border-border bg-card p-8"
          style={{
            shadowColor: "#000",
            shadowOpacity: 0.4,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 8 },
            elevation: 12,
          }}
        >
          <View className="mb-5 h-16 w-16 items-center justify-center rounded-2xl bg-accent/10">
            {showingPinForm ? (
              <KeyRound size={32} color="#10b981" />
            ) : (
              <BiometricIcon size={32} color="#10b981" />
            )}
          </View>

          <Text
            className="text-xl text-foreground"
            style={{ fontFamily: "Inter_700Bold" }}
          >
            {titleByMode[mode]}
          </Text>
          <Text
            className="mt-1 text-center text-sm text-muted"
            style={{ fontFamily: "Inter_400Regular" }}
          >
            {subtitleByMode[mode]}
          </Text>

          {showingPinForm ? (
            <View className="mt-6 w-full">
              <TextInput
                value={pinInput}
                onChangeText={(t) => setPinInput(t.replace(/\D/g, ""))}
                placeholder="••••"
                placeholderTextColor="#52525b"
                secureTextEntry
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
                className="h-12 rounded-xl border border-border bg-background px-4 text-center text-foreground"
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 18,
                  letterSpacing: 6,
                }}
              />
              {mode === "setup" ? (
                <TextInput
                  value={pinConfirm}
                  onChangeText={(t) => setPinConfirm(t.replace(/\D/g, ""))}
                  placeholder="Confirm PIN"
                  placeholderTextColor="#52525b"
                  secureTextEntry
                  keyboardType="number-pad"
                  maxLength={6}
                  className="mt-3 h-12 rounded-xl border border-border bg-background px-4 text-center text-foreground"
                  style={{
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 18,
                    letterSpacing: 6,
                  }}
                />
              ) : null}
              {error ? (
                <Text
                  className="mt-2 text-center text-xs text-danger"
                  style={{ fontFamily: "Inter_500Medium" }}
                >
                  {error}
                </Text>
              ) : null}

              <TouchableOpacity
                onPress={onPinSubmit}
                disabled={busy}
                activeOpacity={0.85}
                className="mt-4 h-12 items-center justify-center rounded-xl bg-accent"
              >
                {busy ? (
                  <ActivityIndicator color="#09090b" />
                ) : (
                  <Text
                    className="text-background"
                    style={{ fontFamily: "Inter_600SemiBold" }}
                  >
                    {mode === "setup" ? "Save PIN" : "Unlock"}
                  </Text>
                )}
              </TouchableOpacity>

              {bioKind !== "none" && mode === "pin" ? (
                <TouchableOpacity
                  onPress={() => {
                    setError(null);
                    setMode("biometric");
                    tryBiometric();
                  }}
                  className="mt-3"
                >
                  <Text
                    className="text-center text-xs text-muted"
                    style={{ fontFamily: "Inter_500Medium" }}
                  >
                    Use {bioKind === "face" ? "Face ID" : "fingerprint"} instead
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            <View className="mt-6 w-full">
              <TouchableOpacity
                onPress={tryBiometric}
                disabled={busy}
                activeOpacity={0.85}
                className="h-12 items-center justify-center rounded-xl bg-accent"
              >
                {busy ? (
                  <ActivityIndicator color="#09090b" />
                ) : (
                  <Text
                    className="text-background"
                    style={{ fontFamily: "Inter_600SemiBold" }}
                  >
                    Unlock with{" "}
                    {bioKind === "face"
                      ? "Face ID"
                      : bioKind === "fingerprint"
                        ? "Touch ID"
                        : "biometrics"}
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  const pinSet = await hasPin();
                  setMode(pinSet ? "pin" : "setup");
                }}
                className="mt-3"
              >
                <Text
                  className="text-center text-xs text-muted"
                  style={{ fontFamily: "Inter_500Medium" }}
                >
                  Use PIN instead
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
