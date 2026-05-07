import { Tabs } from "expo-router";
import * as Haptics from "expo-haptics";
import { useQuickActionRouting } from "expo-quick-actions/router";
import {
  CalendarDays,
  LayoutGrid,
  ListOrdered,
  PieChart,
  Wallet,
} from "lucide-react-native";

const EMERALD = "#10b981";
const ZINC_400 = "#a1a1aa";

export default function TabsLayout() {
  useQuickActionRouting();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#18181b",
          borderTopColor: "#27272a",
          borderTopWidth: 0.5,
        },
        tabBarActiveTintColor: EMERALD,
        tabBarInactiveTintColor: ZINC_400,
        tabBarLabelStyle: {
          fontFamily: "Inter_600SemiBold",
          fontSize: 10,
        },
      }}
      screenListeners={{
        tabPress: () => {
          Haptics.selectionAsync();
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Entry",
          tabBarIcon: ({ color, size }) => (
            <Wallet size={size ?? 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color, size }) => (
            <LayoutGrid size={size ?? 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: "Transactions",
          tabBarIcon: ({ color, size }) => (
            <ListOrdered size={size ?? 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: "Calendar",
          tabBarIcon: ({ color, size }) => (
            <CalendarDays size={size ?? 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: "Reports",
          tabBarIcon: ({ color, size }) => (
            <PieChart size={size ?? 22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
