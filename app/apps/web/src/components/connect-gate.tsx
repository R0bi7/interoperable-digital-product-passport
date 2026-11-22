"use client";

import type { ReactNode } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@/components/connect-button";

/**
 * Shows `children` (the call to action) once a wallet is connected and the wallet button before.
 * The rest of the form stays visible either way, so a visitor can see the whole flow first.
 */
export function ConnectGate({ children }: { children: ReactNode }) {
  const { status } = useAccount();
  if (status !== "disconnected") return children;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="[&>div]:items-start">
        <ConnectButton hint={false} />
      </div>
      <span className="text-sm text-muted-foreground">Connect a wallet to continue.</span>
    </div>
  );
}
