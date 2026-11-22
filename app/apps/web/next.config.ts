import type { NextConfig } from "next";

/**
 * Optional peer dependencies of wallet connectors that this app never calls: the WalletConnect
 * logger's pretty printer, storage fallbacks (including MetaMask's React Native storage), and the x402 payment modules of
 * `@coinbase/cdp-sdk` (pulled in by the Base Account connector). Resolved to empty modules.
 */
const OPTIONAL_PEERS = [
  "pino-pretty",
  "lokijs",
  "encoding",
  "@react-native-async-storage/async-storage",
  "@x402/core",
  "@x402/evm",
  "@x402/svm",
  "@x402/extensions",
  "@x402/express",
  "@x402/fetch",
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Linting is done by Biome (`pnpm lint`), not by next build.
  eslint: { ignoreDuringBuilds: true },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(OPTIONAL_PEERS.map((name) => [name, false])),
    };
    return config;
  },
};

export default nextConfig;
