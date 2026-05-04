/**
 * Shimmer block for loading states. Drop in wherever the data isn't ready
 * yet — sized with className/width/height like any other view.
 *
 *   <Skeleton className="h-6 w-24 rounded" />
 *
 * Animated with Reanimated (UI-thread, no re-renders).
 */
import { useEffect } from "react";
import { View, type ViewProps } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

type Props = ViewProps & {
  /** zinc-800 by default; pass a hex if you want a different base. */
  color?: string;
};

export function Skeleton({ color = "#27272a", style, ...rest }: Props) {
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => cancelAnimation(opacity);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      {...rest}
      style={[{ backgroundColor: color, borderRadius: 8 }, style, animatedStyle]}
    />
  );
}
