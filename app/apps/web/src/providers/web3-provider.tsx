"use client";

import { darkTheme, getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import type { Transport } from "viem";
import { type Config, createConfig, http, injected, WagmiProvider } from "wagmi";
import { supportedChains } from "@/lib/chains";
import { publicEnv } from "@/lib/env";

const APP_NAME = "Whisky Distillery IDPP";

const transports: Record<number, Transport> = Object.fromEntries(
  supportedChains.map((chain) => [chain.id, http()]),
);

function createWagmiConfig(): Config {
  const projectId = publicEnv.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  if (projectId) {
    return getDefaultConfig({
      appName: APP_NAME,
      projectId,
      chains: supportedChains,
      transports,
      ssr: true,
    });
  }
  // Without a WalletConnect project id, offer injected wallets (MetaMask, Rabby, …) only.
  return createConfig({
    chains: supportedChains,
    connectors: [injected()],
    transports,
    ssr: true,
  });
}

// Keep wallet controls and dialogs in the app's dark monochrome identity.
const DARK = darkTheme({
  accentColor: "var(--background)",
  accentColorForeground: "var(--foreground)",
  borderRadius: "small",
  fontStack: "system",
  overlayBlur: "small",
});
DARK.fonts.body = "var(--font-sans), sans-serif";
DARK.colors.modalBackground = "#111317";
DARK.colors.modalBorder = "#2b2f37";
DARK.colors.connectButtonBackground = "var(--background)";
DARK.colors.connectButtonInnerBackground = "var(--background)";
DARK.colors.connectButtonText = "var(--foreground)";
DARK.shadows.connectButton = "inset 0 0 0 1px var(--border)";
DARK.colors.actionButtonSecondaryBackground = "#202329";

export function Web3Provider({ children }: { children: ReactNode }) {
  const [config] = useState(createWagmiConfig);
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={DARK}>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
