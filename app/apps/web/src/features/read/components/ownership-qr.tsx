"use client";

import { QRCodeSVG } from "qrcode.react";
import { useId } from "react";
import { Textarea } from "@/components/ui/textarea";

/** The selectable text is exactly the QR's JSON, usable when either device has no camera. */
export function OwnershipQr({ value, label }: { value: string; label: string }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <QRCodeSVG
        value={value}
        size={256}
        level="M"
        marginSize={4}
        role="img"
        aria-label={`${label} QR code`}
        className="h-auto max-w-full rounded-lg border bg-white"
      />
      <label htmlFor={id} className="text-sm font-medium">
        {label} JSON
      </label>
      <Textarea
        id={id}
        readOnly
        value={value}
        className="field-sizing-fixed min-h-32 w-full min-w-0 font-mono text-xs"
      />
    </div>
  );
}
