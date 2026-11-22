"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { describeCameraError } from "../camera-error";
import { extractPassportRef, passportPath } from "../token-id";

const READER_ID = "idpp-qr-reader";

/**
 * Camera QR scan (html5-qrcode, loaded in the browser only) plus a text field for the same inputs.
 * Defaults to passport/deployment navigation; `onDecode` lets ownership flows reuse both inputs.
 */
export function ScanView({
  onDecode,
  inputLabel = "Token id or passport URL",
  submitLabel = "Open",
}: {
  onDecode?: (text: string) => void | Promise<void>;
  inputLabel?: string;
  submitLabel?: string;
} = {}) {
  const router = useRouter();
  const inputId = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraPaused, setCameraPaused] = useState(false);
  const handled = useRef(false);
  const decodeRef = useRef(onDecode);
  useEffect(() => {
    decodeRef.current = onDecode;
  }, [onDecode]);

  const open = async (input: string): Promise<boolean> => {
    try {
      if (decodeRef.current) {
        await decodeRef.current(input);
      } else {
        const ref = extractPassportRef(input);
        if (ref === null) throw new Error("Not a token id or passport URL.");
        router.push(passportPath(ref.tokenId, ref.deploymentId));
      }
      setError(null);
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: the scanner starts once per mount
  useEffect(() => {
    let stop: (() => Promise<void>) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        const scanner = new Html5Qrcode(READER_ID);
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded) => {
            if (handled.current) return;
            handled.current = true;
            const staysOnPage = decodeRef.current !== undefined;
            void open(decoded).then((ok) => {
              // Ownership flows remain mounted after decoding. Require an explicit resume so
              // the same video frame cannot issue repeated RPC checks or replace a challenge.
              if (staysOnPage) setCameraPaused(true);
              else if (!ok) handled.current = false;
            });
          },
          () => {
            // per-frame decode misses are expected
          },
        );
        setCameraReady(true);
        stop = async () => {
          if (scanner.isScanning) await scanner.stop();
          scanner.clear();
        };
        if (cancelled) await stop();
      } catch (e) {
        if (!cancelled) {
          setCameraError(
            describeCameraError(
              e,
              window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia),
            ),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      void stop?.();
    };
  }, []);

  return (
    <section className="flex flex-col gap-4">
      {!cameraError && (
        <div className="relative aspect-square w-full max-w-sm overflow-hidden rounded-xl border bg-muted">
          <div id={READER_ID} className="size-full [&_video]:size-full [&_video]:object-cover" />
          {!cameraReady && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Starting the camera…
            </div>
          )}
        </div>
      )}
      {onDecode && cameraReady && cameraPaused && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">
            The camera is paused after reading a code.
          </span>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              handled.current = false;
              setCameraPaused(false);
              setError(null);
            }}
          >
            Scan another code
          </Button>
        </div>
      )}
      {cameraError && <Notice tone="warn">{cameraError} Use the text input below instead.</Notice>}
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void open(text);
        }}
      >
        <label htmlFor={inputId} className="text-sm font-medium">
          {inputLabel}
        </label>
        <div className="flex flex-col gap-3 sm:items-start">
          {onDecode ? (
            <Textarea
              id={inputId}
              className="field-sizing-fixed min-h-32 w-full min-w-0 font-mono text-sm"
              placeholder="Paste the QR code text"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          ) : (
            <Input
              id={inputId}
              className="h-11 min-w-0 w-full font-mono"
              inputMode="numeric"
              placeholder="421614000000000001"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          )}
          <Button
            type="submit"
            size="lg"
            className="min-h-11 w-full max-w-full whitespace-normal sm:w-auto"
          >
            {submitLabel}
          </Button>
        </div>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
    </section>
  );
}
