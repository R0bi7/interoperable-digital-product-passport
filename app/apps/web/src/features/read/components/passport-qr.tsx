"use client";

import { MANIFEST } from "@idpp/passport-config";
import { Check, Copy, Download } from "lucide-react";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { publicEnv } from "@/lib/env";
import { passportUrl } from "../token-id";

const SIZE = 192;
const PNG_SIZE = 768;

/**
 * QR code for a passport's page. It encodes the absolute `/passport/<id>` URL, which the scan page
 * reads back with `extractTokenId`, so a printed label on a cask or bottle opens the same record.
 */
export function PassportQr({ tokenId }: { tokenId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(
    () =>
      setUrl(
        passportUrl(
          publicEnv.NEXT_PUBLIC_BASE_URL ?? window.location.origin,
          tokenId,
          MANIFEST.deploymentId,
        ),
      ),
    [tokenId],
  );

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2_000);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!url) return null;

  const download = () => {
    const href = canvas.current?.toDataURL("image/png");
    if (!href) return;
    const link = document.createElement("a");
    link.href = href;
    link.download = `passport-${tokenId}.png`;
    link.click();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard needs a secure context and permission; the URL stays visible and selectable.
      setCopyFailed(true);
    }
  };

  return (
    <div className="flex min-w-0 flex-col items-start gap-4">
      <QRCodeSVG
        value={url}
        size={SIZE}
        level="M"
        marginSize={4}
        role="img"
        aria-label={`QR code linking to ${url}`}
        className="shrink-0 rounded-lg border bg-white"
      />
      {/* Hidden high-resolution copy, only used for the PNG download. */}
      <QRCodeCanvas
        ref={canvas}
        value={url}
        size={PNG_SIZE}
        level="M"
        marginSize={4}
        className="hidden"
      />
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Print this on the cask or bottle. Scanning it opens this passport and its verification.
        </p>
        <p className="break-all font-mono text-xs">{url}</p>
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" variant="outline" onClick={download}>
            <Download aria-hidden data-icon="inline-start" />
            Download PNG
          </Button>
          <Button className="min-h-11" variant="outline" onClick={copy}>
            {copied ? (
              <Check aria-hidden data-icon="inline-start" />
            ) : (
              <Copy aria-hidden data-icon="inline-start" />
            )}
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
        {copyFailed && (
          <p role="alert" className="text-xs text-muted-foreground">
            Could not copy automatically; select the link above instead.
          </p>
        )}
      </div>
    </div>
  );
}
