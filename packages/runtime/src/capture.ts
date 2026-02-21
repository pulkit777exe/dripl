export type CaptureMode =
  | "IMMEDIATELY"
  | "CAPTURE_ONCE"
  | "EPHEMERAL"
  | "NEVER";        

export function shouldCaptureToHistory(mode: CaptureMode): boolean {
  return mode === "IMMEDIATELY" || mode === "CAPTURE_ONCE";
}
