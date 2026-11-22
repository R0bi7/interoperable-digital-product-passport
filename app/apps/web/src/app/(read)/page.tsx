import { Camera, FilePlus2 } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { ReadinessPanel } from "@/features/demo/readiness-panel";
import { PassportList } from "@/features/read/components/passport-list";

export default function HomePage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Passports"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/scan"
              className={`${buttonVariants({ variant: "outline", size: "lg" })} min-h-11`}
            >
              <Camera aria-hidden data-icon="inline-start" />
              Scan a label
            </Link>
            <Link href="/mint" className={`${buttonVariants({ size: "lg" })} min-h-11`}>
              <FilePlus2 aria-hidden data-icon="inline-start" />
              Mint a passport
            </Link>
          </div>
        }
        lead="Casks and bottles of the distillery, tracked across chains. Open one to verify its payload against the chain."
      />
      <ReadinessPanel />
      <PassportList />
    </div>
  );
}
