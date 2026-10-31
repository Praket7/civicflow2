import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff } from "lucide-react";
import { Button, Input } from "./ui";
import styles from "./pwa.module.css";

/**
 * A scan is a code, not a sentence. The kiosk prints `civicflow://checkin/<token>`;
 * a pasted token, a six-digit code, or a link with `code=` are all the same
 * answer once trimmed.
 */
export function parseScannedCode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const prefixed = trimmed.match(/^civicflow:\/\/checkin\/(.+)$/i);
  if (prefixed) return decodeURIComponent(prefixed[1]);
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return url.searchParams.get("code") ?? url.searchParams.get("token") ?? "";
    } catch {
      return "";
    }
  }
  return trimmed;
}

export function ScanField({
  onCode,
  disabled,
}: {
  onCode: (code: string) => void;
  disabled?: boolean;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const onCodeRef = useRef(onCode);
  const [scanning, setScanning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  // The parent may pass a new callback on every render. The camera effect must
  // not restart when that happens, or the preview flickers.
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    if (!scanning) return;
    let stopped = false;
    let controls: { stop: () => void } | null = null;
    void (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader();
        const device = await reader.decodeFromVideoDevice(
          undefined,
          video.current ?? undefined,
          (result) => {
            if (stopped || !result) return;
            const code = parseScannedCode(result.getText());
            if (!code) return;
            stopped = true;
            onCodeRef.current(code);
            setScanning(false);
          },
        );
        // Unmounting or stopping while the permission prompt is open leaves a
        // live camera behind if the late-resolved handle is not closed.
        if (stopped) {
          device.stop();
          return;
        }
        controls = device;
      } catch (caught) {
        if (stopped) return;
        setScanning(false);
        setProblem(
          caught instanceof Error && /permission|denied|not allowed/i.test(caught.message)
            ? "Camera access was denied. Enter the code from the table instead."
            : "This browser could not start the camera. Enter the code instead.",
        );
      }
    })();
    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [scanning]);

  return (
    <div className={styles.scan}>
      {scanning ? (
        <div className={styles.videoWrap}>
          <video
            ref={video}
            className={styles.video}
            autoPlay
            muted
            playsInline
            aria-label="Camera preview for the shift code"
          />
          <span className={styles.scanFrame} aria-hidden />
        </div>
      ) : null}
      <div className={styles.scanActions}>
        <Button
          type="button"
          variant={scanning ? "secondary" : "primary"}
          disabled={disabled}
          onClick={() => {
            setProblem(null);
            setScanning((value) => !value);
          }}
        >
          {scanning ? <CameraOff aria-hidden size={17} /> : <Camera aria-hidden size={17} />}
          {scanning ? "Stop camera" : "Scan the code"}
        </Button>
      </div>
      {problem ? <p className={styles.notice}>{problem}</p> : null}
      <form
        className={styles.manualCode}
        onSubmit={(event) => {
          event.preventDefault();
          const code = parseScannedCode(manual);
          if (code) onCode(code);
        }}
      >
        <label className={styles.fieldLabel} htmlFor="manual-code">
          Or type the code
        </label>
        <div className={styles.inlineField}>
          <Input
            id="manual-code"
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            placeholder="6-digit code"
            autoComplete="one-time-code"
            inputMode="numeric"
            disabled={disabled}
          />
          <Button type="submit" variant="secondary" disabled={disabled || manual.trim() === ""}>
            Use code
          </Button>
        </div>
      </form>
    </div>
  );
}
