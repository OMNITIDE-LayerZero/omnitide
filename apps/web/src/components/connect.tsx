"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ChevronDown, Wallet } from "lucide-react";

/** RainbowKit's modal flow, drawn in our own controls. */
export function Connect({ size = "sm" }: { size?: "sm" | "md" }) {
  const cls = size === "sm" ? "btn btn-sm" : "btn";
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        if (!mounted) return <span className={`${cls} btn-secondary invisible`}>Connect wallet</span>;
        if (!account || !chain)
          return (
            <button type="button" onClick={openConnectModal} className={`${cls} btn-primary`}>
              <Wallet size={16} strokeWidth={1.5} />
              Connect wallet
            </button>
          );
        return (
          <div className="flex items-center gap-2">
            <button type="button" onClick={openChainModal} className={`${cls} btn-secondary ${chain.unsupported ? "text-ebb" : ""}`}>
              {chain.unsupported ? "Wrong network" : chain.name}
              <ChevronDown size={14} strokeWidth={1.5} className="text-ink-3" />
            </button>
            <button type="button" onClick={openAccountModal} className={`${cls} btn-secondary font-mono`}>
              {account.displayName}
            </button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
