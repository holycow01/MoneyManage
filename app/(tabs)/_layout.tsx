import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#18181b",
          borderTopColor: "#27272a",
        },
        tabBarActiveTintColor: "#10b981",
        tabBarInactiveTintColor: "#a1a1aa",
      }}
    />
  );
}
