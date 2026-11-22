/**
 * User-facing text for a failed camera start. html5-qrcode rejects with a string or an `Error`
 * that embeds the browser's `DOMException` name (`Error getting userMedia, error = NotAllowedError:
 * Permission denied`), so the cause is recognised by name inside the text. `cameraApi` is false on a page without
 * `navigator.mediaDevices.getUserMedia` (an insecure origin such as http on a LAN address).
 */
export function describeCameraError(error: unknown, cameraApi: boolean): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (!cameraApi) {
    return "The camera is not available on this page (it needs https or localhost).";
  }
  if (/NotAllowedError|PermissionDeniedError|permission/i.test(raw)) {
    return "Camera access was denied. Allow the camera for this site in the browser settings and reload.";
  }
  if (/NotFoundError|DevicesNotFoundError|no camera|Requested device not found/i.test(raw)) {
    return "No camera was found on this device.";
  }
  if (/NotReadableError|TrackStartError|in use/i.test(raw)) {
    return "The camera is in use by another application.";
  }
  return `The camera could not be started (${raw.slice(0, 120)}).`;
}
