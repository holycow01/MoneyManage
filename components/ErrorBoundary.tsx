/**
 * App-wide error boundary.
 *
 *   <ErrorBoundary>
 *     <Slot />
 *   </ErrorBoundary>
 *
 * Catches render errors and shows a friendly retry screen instead of a
 * red box. The fallback is intentionally minimal — same dark surface as
 * the rest of the app, no stack trace by default. In dev, the error
 * message shows so you can fix it; in prod we hide it.
 */
import React from "react";
import {
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { AlertOctagon, RefreshCw } from "lucide-react-native";

const EMERALD = "#10b981";
const ZINC_400 = "#a1a1aa";
const ROSE = "#f43f5e";

type Props = {
  children: React.ReactNode;
  /** Custom render function. If provided, `error` and `retry` are passed to it. */
  fallback?: (props: { error: Error; retry: () => void }) => React.ReactNode;
};

type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // In a real app, ship this to Sentry / Logflare / Bugsnag.
    if (__DEV__) {
      console.error("ErrorBoundary caught:", error, info?.componentStack);
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) {
      return this.props.fallback({ error, retry: this.reset });
    }
    return <DefaultFallback error={error} retry={this.reset} />;
  }
}

function DefaultFallback({
  error,
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center bg-background px-8">
      <View
        className="h-16 w-16 rounded-2xl items-center justify-center mb-5"
        style={{ backgroundColor: `${ROSE}1f` }}
      >
        <AlertOctagon size={28} color={ROSE} />
      </View>
      <Text
        style={{
          fontFamily: "Inter_700Bold",
          fontSize: 18,
          color: "#f4f4f5",
        }}
      >
        Something went wrong
      </Text>
      <Text
        className="text-center mt-2"
        style={{
          fontFamily: "Inter_400Regular",
          fontSize: 13,
          color: ZINC_400,
          maxWidth: 320,
          lineHeight: 19,
        }}
      >
        Pulse hit an unexpected error. Tap retry below — if it keeps
        happening, send feedback from Settings and we'll take a look.
      </Text>

      {__DEV__ ? (
        <Text
          className="text-center mt-3"
          numberOfLines={4}
          style={{
            fontFamily: "Inter_400Regular",
            fontSize: 11,
            color: ROSE,
            maxWidth: 320,
          }}
        >
          {error.message}
        </Text>
      ) : null}

      <TouchableOpacity
        onPress={retry}
        accessibilityLabel="Retry"
        activeOpacity={0.85}
        className="mt-6 h-11 px-5 rounded-full flex-row items-center"
        style={{ backgroundColor: EMERALD }}
      >
        <RefreshCw size={14} color="#09090b" />
        <Text
          className="ml-2"
          style={{
            fontFamily: "Inter_700Bold",
            fontSize: 13,
            color: "#09090b",
          }}
        >
          Retry
        </Text>
      </TouchableOpacity>
    </View>
  );
}
