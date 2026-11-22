"use client";

import { useState, useSyncExternalStore } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { connectorsForWallets, darkTheme, lightTheme, RainbowKitProvider, type Theme } from "@rainbow-me/rainbowkit";
import { coinbaseWallet, injectedWallet, metaMaskWallet, rabbyWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { CHAIN_LIST, proxiedRpc } from "@/lib/chains";
import { useTheme } from "./theme";

const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "";

function makeConfig() {
  const connectors = connectorsForWallets(
    [{ groupName: "Wallets", wallets: projectId ? [metaMaskWallet, rabbyWallet, coinbaseWallet, walletConnectWallet] : [injectedWallet, rabbyWallet, coinbaseWallet] }],
    { appName: "OMNITIDE", projectId: projectId || "omnitide" },
  );
  return createConfig({
    chains: CHAIN_LIST,
    connectors,
    transports: Object.fromEntries(CHAIN_LIST.map((c) => [c.id, http(proxiedRpc(c.id), { batch: true })])),
    ssr: true,
  });
}

function brandTheme(dark: boolean): Theme {
  const base = (dark ? darkTheme : lightTheme)({ accentColor: "#5671ff", borderRadius: "small", fontStack: "system", overlayBlur: "small" });
  return {
    ...base,
    fonts: { body: "var(--font-geist), system-ui, sans-serif" },
    colors: {
      ...base.colors,
      modalBackground: dark ? "#11141c" : "#ffffff",
      modalBorder: dark ? "rgba(238,240,245,0.08)" : "rgba(14,20,48,0.09)",
      modalText: dark ? "#eef0f5" : "#0e1430",
      modalTextSecondary: dark ? "#a3a9b8" : "#475069",
      profileForeground: dark ? "#11141c" : "#ffffff",
      menuItemBackground: dark ? "#1a1e28" : "#e9edf4",
      generalBorder: dark ? "rgba(238,240,245,0.08)" : "rgba(14,20,48,0.09)",
      modalBackdrop: dark ? "rgba(7,8,13,0.7)" : "rgba(14,20,48,0.35)",
    },
    shadows: { ...base.shadows, dialog: dark ? "0 8px 24px rgba(0,0,0,0.35)" : "0 8px 24px rgba(14,20,48,0.07)", connectButton: "none" },
  };
}

const noop = () => () => {};

export function Providers({ children }: { children: React.ReactNode }) {
  const [config] = useState(makeConfig);
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 4_000, refetchOnWindowFocus: false, retry: 2 } } }));
  const { theme } = useTheme();
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={brandTheme(mounted && theme === "dark")} modalSize="compact" appInfo={{ appName: "OMNITIDE" }}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
