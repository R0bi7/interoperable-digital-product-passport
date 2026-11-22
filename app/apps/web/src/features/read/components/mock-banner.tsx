import { Notice } from "@/components/notice";

/** Shown on every read page while `NEXT_PUBLIC_INDEXER_URL` is unset and fixtures stand in. */
export function MockBanner({ scenario }: { scenario?: string }) {
  return (
    <Notice tone="warn">
      <p role="note">
        <strong>Mock data.</strong> <code>NEXT_PUBLIC_INDEXER_URL</code> is not set, so the indexer,
        the IPFS gateway and the chain are simulated by fixtures. Nothing here is read from a real
        deployment.
        {scenario ? ` Scenario: ${scenario}.` : ""}
      </p>
    </Notice>
  );
}
