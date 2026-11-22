import type { Page } from "@playwright/test";

declare global {
  interface Window {
    __cameraCode: string;
    __cameraFrames: number;
  }
}

/**
 * Exercise html5-qrcode's real video/canvas loop and decode callback without a physical camera.
 * Only the native BarcodeDetector result is stubbed; no app or scanner module is rewritten.
 */
export async function installCamera(page: Page) {
  await page.addInitScript(() => {
    window.__cameraCode = "";
    window.__cameraFrames = 0;
    Object.defineProperty(window, "BarcodeDetector", {
      configurable: true,
      value: class {
        static async getSupportedFormats() {
          return ["qr_code"];
        }
        async detect() {
          window.__cameraFrames++;
          return window.__cameraCode
            ? [
                {
                  rawValue: window.__cameraCode,
                  format: "qr_code",
                  boundingBox: { width: 200, height: 200 },
                },
              ]
            : [];
        }
      },
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        async getUserMedia() {
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 480;
          const context = canvas.getContext("2d");
          const paint = () => {
            if (context) {
              context.fillStyle = "white";
              context.fillRect(0, 0, canvas.width, canvas.height);
            }
            requestAnimationFrame(paint);
          };
          paint();
          return canvas.captureStream(10);
        },
      },
    });
  });
}

export async function showCameraCode(page: Page, text: string) {
  await page.evaluate((code) => {
    window.__cameraCode = code;
  }, text);
}
