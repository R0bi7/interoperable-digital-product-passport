import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { Web3Provider } from "@/providers/web3-provider";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: { default: "Whisky Distillery IDPP", template: "%s · Whisky Distillery IDPP" },
  description: "Interoperable Digital Product Passports for casks and bottles",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${mono.variable}`}>
      <body>
        <Web3Provider>
          <AppShell>{children}</AppShell>
        </Web3Provider>
      </body>
    </html>
  );
}
