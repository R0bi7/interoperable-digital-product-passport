"use client";

import { ArrowUpRight, Camera, FilePlus2, Layers } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ConnectButton } from "@/components/connect-button";
import { cn } from "@/lib/utils";

const NAV = [
  {
    href: "/",
    label: "Passports",
    icon: Layers,
    match: (p: string) => p === "/" || p.startsWith("/passport"),
  },
  { href: "/scan", label: "Scan", icon: Camera, match: (p: string) => p.startsWith("/scan") },
  { href: "/mint", label: "Mint", icon: FilePlus2, match: (p: string) => p.startsWith("/mint") },
];

/** Header, navigation and wallet button shared by every page. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur-sm">
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-4 py-4 xl:grid-cols-[auto_minmax(0,1fr)_auto]">
          <Link href="/" className="flex min-w-0 items-center gap-2.5 leading-tight">
            <Layers aria-hidden className="hidden size-7 shrink-0 text-foreground sm:block" />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-base font-semibold tracking-tight">Whisky Distillery</span>
              <span className="hidden text-xs text-muted-foreground sm:block">
                Interoperable Digital Product Passport
              </span>
            </span>
          </Link>
          <nav
            aria-label="Main"
            className="col-span-2 row-start-2 flex flex-wrap gap-1 xl:col-span-1 xl:col-start-2 xl:row-start-1"
          >
            {NAV.map(({ href, label, icon: Icon, match }) => {
              const active = match(pathname);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-secondary hover:text-foreground",
                    active
                      ? "border-ring/30 bg-accent font-medium text-accent-foreground"
                      : "border-transparent text-muted-foreground",
                  )}
                >
                  <Icon aria-hidden className="size-4" />
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="col-start-2 row-start-1 min-w-0 justify-self-end xl:col-start-3">
            <ConnectButton />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-muted-foreground">
          <span>Whisky Distillery · Testnet demonstrator</span>
          <a
            href="https://layerzero.network/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 transition-colors hover:text-foreground"
          >
            Cross-chain transport by LayerZero <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
        </div>
      </footer>
    </div>
  );
}
