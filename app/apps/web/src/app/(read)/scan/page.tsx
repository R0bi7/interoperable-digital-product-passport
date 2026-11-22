import { PageHeader } from "@/components/page-header";
import { ScanView } from "@/features/read/components/scan-view";

export const metadata = { title: "Scan a passport" };

export default function ScanPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <PageHeader
        title="Scan a passport QR code"
        lead="Point the camera at the code on a cask or bottle, or enter the token id by hand."
      />
      <ScanView />
    </div>
  );
}
