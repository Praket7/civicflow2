import { useEffect, useRef, useState } from "react";
import { CameraOff, X } from "lucide-react";
import { BrowserQRCodeReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import styles from "./QrScanner.module.css";
import { messageOf } from "../../lib/errors";

interface QrScannerProps {
  onScan: (payload: string) => void;
  onClose: () => void;
}

export function QrScanner({ onScan, onClose }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const scanRef = useRef(onScan);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    scanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let controls: IScannerControls | undefined;
    let active = true;
    const reader = new BrowserQRCodeReader();
    reader
      .decodeFromVideoDevice(undefined, video, (result) => {
        if (!active || !result) return;
        active = false;
        controls?.stop();
        scanRef.current(result.getText());
      })
      .then((next) => {
        controls = next;
        if (active) setStarting(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setStarting(false);
        setError(
          messageOf(
            caught,
            "The camera could not start. Allow camera access for CivicFlow and try again.",
          ),
        );
      });
    return () => {
      active = false;
      controls?.stop();
    };
    // The decoder starts once; the latest callback is read through scanRef.
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className={styles.backdrop}>
      <button
        type="button"
        className={styles.dismiss}
        onClick={onClose}
        aria-label="Close scanner"
      />
      <section
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-scanner-title"
      >
        <header className={styles.head}>
          <div>
            <p className={styles.eyebrow}>Camera check-in</p>
            <h2 className={styles.title} id="qr-scanner-title">
              Scan the volunteer&rsquo;s QR code
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close scanner"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className={styles.viewfinder}>
          <video
            ref={videoRef}
            className={styles.video}
            muted
            playsInline
            aria-label="Camera preview"
          />
          <span className={styles.frame} aria-hidden="true" />
        </div>

        <p className={styles.help} role="status">
          {error ? (
            <>
              <CameraOff size={14} aria-hidden="true" /> {error}
            </>
          ) : starting ? (
            "Starting the camera…"
          ) : (
            "Hold the QR code inside the frame. The token is checked by the Rust core before a check-in is recorded."
          )}
        </p>
        {error ? (
          <button type="button" className={styles.fallback} onClick={onClose}>
            Use the six-digit code instead
          </button>
        ) : null}
      </section>
    </div>
  );
}
