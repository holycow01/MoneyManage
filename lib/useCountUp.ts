/**
 * Animate a number from its current displayed value toward a new target.
 *
 *   const display = useCountUp(amount);
 *   <Text>{formatNumber(display)}</Text>
 *
 * Uses requestAnimationFrame with an easeOut cubic curve. We deliberately
 * don't use Reanimated's shared values here because <Text> can't bind its
 * content to a worklet — it'd require <Animated.Text> + a JS bridge hop on
 * every frame, which costs more than just calling setState.
 */
import { useEffect, useRef, useState } from "react";

export function useCountUp(target: number, duration = 600): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) {
      setValue(target);
      return;
    }
    const startTs = Date.now();
    let raf = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - startTs) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (target - from) * eased;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}
