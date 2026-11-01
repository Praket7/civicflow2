import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import { Button } from "../../components/ui";
import { t } from "../../lib/i18n";
import { FunderPacket, type PacketSection } from "./FunderPacket";
import { PACKET_PAGE_CONTENT_HEIGHT, paginatePacketSections } from "./packetPagination";
import styles from "./shared.module.css";

interface FunderPacketPreviewProps {
  sections: PacketSection[];
  organizationName: string;
  rangeLabel: string;
  onClose: () => void;
  onPrint: () => void;
}

/**
 * A native modal keeps focus inside the preview and lets Escape close it
 * without a hand-written focus trap. The hidden copy at paper width measures
 * every section before the visible pages are assembled, so the preview uses
 * the same breaks the printer receives.
 */
export function FunderPacketPreview({
  sections,
  organizationName,
  rangeLabel,
  onClose,
  onPrint,
}: FunderPacketPreviewProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const [pageKeys, setPageKeys] = useState<string[][] | null>(null);
  const [oversized, setOversized] = useState(false);
  const titleId = useId();

  // This must open the dialog before the measuring effect below runs: a closed
  // dialog has no layout, so every section would measure as zero.
  useLayoutEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    const previousPrint = document.body.dataset.packetPrint;
    document.body.style.overflow = "hidden";
    // The print stylesheet needs a selector that hides the app shell while the
    // paper copy renders. The preview is the only place that copy exists.
    document.body.dataset.packetPrint = "true";
    dialog?.showModal();
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      if (previousPrint === undefined) delete document.body.dataset.packetPrint;
      else document.body.dataset.packetPrint = previousPrint;
      if (dialog?.open) dialog.close();
      restoreRef.current?.focus();
    };
  }, []);

  useLayoutEffect(() => {
    let canceled = false;

    function measure() {
      if (canceled) return;
      const root = measureRef.current;
      if (!root) return;
      const heights = Array.from(root.querySelectorAll<HTMLElement>("[data-packet-section]")).map(
        (node) => {
          const style = window.getComputedStyle(node);
          const height =
            node.getBoundingClientRect().height +
            (Number.parseFloat(style.marginTop) || 0) +
            (Number.parseFloat(style.marginBottom) || 0);
          return { key: node.dataset.packetSection ?? "", height };
        },
      );
      setPageKeys(paginatePacketSections(heights));
      // One section taller than the paper spills onto extra physical pages,
      // so the sheet count below would understate the printout. Say so rather
      // than promising a page count the printer cannot keep.
      setOversized(heights.some((section) => section.height > PACKET_PAGE_CONTENT_HEIGHT));
    }

    measure();
    // Web fonts can settle after the first paint and change a line wrap.
    if (document.fonts) void document.fonts.ready.then(() => measure());

    return () => {
      canceled = true;
    };
  }, [sections]);

  const sectionByKey = useMemo(
    () => new Map(sections.map((section) => [section.key, section])),
    [sections],
  );
  const measuredPages = useMemo(() => {
    if (!pageKeys) return [];
    return pageKeys
      .map((keys) =>
        keys
          .map((key) => sectionByKey.get(key))
          .filter((section): section is PacketSection => section !== undefined),
      )
      .filter((page) => page.length > 0);
  }, [pageKeys, sectionByKey]);
  // Before the first measurement (and in a layout-less test) the packet still
  // has a preview: one continuous sheet rather than an empty dialog.
  const pages = measuredPages.length > 0 ? measuredPages : [sections];

  function close() {
    onClose();
  }

  return (
    <>
      <dialog
        ref={dialogRef}
        className={styles.previewDialog}
        data-theme="dark"
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <div className={styles.previewPanel}>
          <header className={styles.previewToolbar}>
            <div>
              <p className={styles.previewEyebrow}>Preview</p>
              <h2 id={titleId} className={styles.previewTitle}>
                Funder packet preview
              </h2>
              <p className={styles.previewMeta}>
                {organizationName}
                <span aria-hidden="true"> · </span>
                {rangeLabel}
              </p>
              {oversized ? (
                <p className={styles.previewWarning} role="status">
                  A section is longer than one Letter page. Print will continue it on another sheet,
                  so the printout may have more pages than this preview.
                </p>
              ) : null}
            </div>
            <div className={styles.previewActions}>
              <Button variant="primary" icon={<Printer aria-hidden size={14} />} onClick={onPrint}>
                Print / save PDF
              </Button>
              <button
                ref={closeRef}
                type="button"
                className={styles.previewClose}
                onClick={close}
                aria-label="Close"
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>
          </header>

          <div className={styles.previewDesk}>
            <div className={styles.previewStack}>
              {pages.map((page, index) => (
                <div className={styles.previewSheet} key={page[0]?.key ?? index}>
                  <p className={styles.previewPageLabel}>
                    {t("Page {page} of {count}", {
                      page: index + 1,
                      count: pages.length,
                    })}
                  </p>
                  <FunderPacket
                    sections={page}
                    className={styles.packetPage}
                    label={`${t("Funder packet")} ${index + 1}`}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div ref={measureRef} aria-hidden="true">
          <FunderPacket sections={sections} className={styles.packetMeasure} />
        </div>
      </dialog>

      {pageKeys
        ? createPortal(
            <div className={styles.packetPrint} aria-hidden="true">
              {pages.map((page, index) => (
                <div className={styles.packetPrintSheet} key={page[0]?.key ?? index}>
                  <FunderPacket
                    sections={page}
                    className={styles.packetPage}
                    label={`${t("Funder packet")} ${index + 1}`}
                    testId="packet-print-page"
                  />
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
