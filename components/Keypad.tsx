/**
 * Shared calculator keypad. Used by the home quick-entry screen and the
 * transaction edit sheet. The component is purely presentational — it
 * forwards every keypress through `onKey` to whatever store/state owns
 * the expression.
 *
 * `<Keypad>` renders the 4×4 grid only. The Save button is a separate
 * component (`<KeypadSaveButton>`) so callers can place it anywhere
 * (full-width below the grid, in a sheet header, etc.).
 */
import { Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Delete as DeleteIcon } from "lucide-react-native";
import { useEffect } from "react";
import { ActivityIndicator, TouchableOpacity } from "react-native";

const ROWS: string[][] = [
  ["1", "2", "3", "÷"],
  ["4", "5", "6", "×"],
  ["7", "8", "9", "−"],
  [".", "0", "⌫", "+"],
];
const OPS = new Set(["+", "−", "×", "÷"]);

export function Keypad({
  onKey,
  haptics = true,
}: {
  onKey: (key: string) => void;
  haptics?: boolean;
}) {
  const handle = (k: string) => {
    if (haptics) Haptics.selectionAsync();
    onKey(k);
  };
  return (
    <View>
      {ROWS.map((row, i) => (
        <View key={i} className="flex-row">
          {row.map((k) => (
            <KeypadKey key={k} k={k} onPress={() => handle(k)} />
          ))}
        </View>
      ))}
    </View>
  );
}

function KeypadKey({ k, onPress }: { k: string; onPress: () => void }) {
  const isOp = OPS.has(k);
  const isBackspace = k === "⌫";
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View className="flex-1 p-1.5">
      <Animated.View style={animStyle}>
        <Pressable
          onPressIn={() => {
            scale.value = withSpring(0.94, { damping: 18, stiffness: 350 });
          }}
          onPressOut={() => {
            scale.value = withSpring(1, { damping: 14, stiffness: 220 });
          }}
          onPress={onPress}
          className="h-14 rounded-2xl bg-card border border-border items-center justify-center active:opacity-80"
        >
          {isBackspace ? (
            <DeleteIcon size={22} color="#a1a1aa" />
          ) : (
            <Text
              style={{
                fontFamily: isOp ? "Inter_600SemiBold" : "Inter_500Medium",
                fontSize: 22,
                color: isOp ? "#10b981" : "#f4f4f5",
              }}
            >
              {k}
            </Text>
          )}
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** Big emerald button used as the keypad's "Save" companion. */
export function KeypadSaveButton({
  disabled,
  highlighted = false,
  busy = false,
  onPress,
  label = "Save",
}: {
  disabled: boolean;
  highlighted?: boolean;
  busy?: boolean;
  onPress: () => void;
  label?: string;
}) {
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = withSpring(highlighted ? 1.02 : 1, {
      damping: 12,
      stiffness: 220,
    });
  }, [highlighted, scale]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return (
    <Animated.View style={style} className="px-1.5 mt-2">
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled || busy}
        activeOpacity={0.85}
        className="h-14 items-center justify-center rounded-2xl"
        style={{
          backgroundColor: disabled ? "#1f2937" : "#10b981",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {busy ? (
          <ActivityIndicator color="#09090b" />
        ) : (
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 16,
              color: disabled ? "#a1a1aa" : "#09090b",
            }}
          >
            {label}
          </Text>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}
