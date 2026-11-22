"use client";

import { ConnectButton as RainbowConnectButton } from "@rainbow-me/rainbowkit";
import { useEffect, useState } from "react";
import { useAccount, useConnectors } from "wagmi";
import { publicEnv } from "@/lib/env";

/**
 * RainbowKit's connect button. Without `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` only injected wallets
 * are offered, and RainbowKit's modal is an empty "Connect a Wallet" dialog when the browser has
 * none; this adds a line that says so, instead of leaving the visitor at a dead end.
 */
export function ConnectButton({ hint = true }: { hint?: boolean }) {
  const { isConnected } = useAccount();
  const connectors = useConnectors();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // The generic `injected` connector is always registered; it is usable only if `window.ethereum`
  // exists. Wallets announced through EIP-6963 add their own connector.
  const hasWallet = connectors.some(
    (connector) =>
      connector.id !== "injected" || (typeof window !== "undefined" && "ethereum" in window),
  );
  const showHint =
    hint &&
    mounted &&
    !isConnected &&
    !publicEnv.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID &&
    !hasWallet;

  return (
    <div className="flex max-w-full flex-col items-end gap-1 [&_button]:min-h-11 [&_button]:min-w-11">
      <RainbowConnectButton
        accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
        chainStatus={{ smallScreen: "icon", largeScreen: "full" }}
        showBalance={{ smallScreen: false, largeScreen: true }}
      />
      {showHint ? (
        <p role="status" className="max-w-44 text-right text-xs text-warning sm:max-w-56">
          No browser wallet found. Install an Ethereum wallet extension (for example MetaMask) and
          reload.
        </p>
      ) : null}
    </div>
  );
}
