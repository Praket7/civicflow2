import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowRight, CircleHelp, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { topicForPath } from "../../lib/help/topics";
import styles from "./HelpDialog.module.css";

interface HelpContextValue {
  available: boolean;
  openHelp: () => void;
}

const HelpContext = createContext<HelpContextValue>({ available: false, openHelp: () => {} });

export function useHelp(): HelpContextValue {
  return useContext(HelpContext);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable ||
    target.getAttribute("role") === "combobox" ||
    target.getAttribute("role") === "textbox"
  );
}

/**
 * Owns the contextual help dialog and the `?` shortcut. The provider sits in
 * the authenticated shell, so public screens never advertise help they do not
 * have.
 */
export function HelpProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const openHelp = useCallback(() => setOpen(true), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key !== "?" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTypingTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <HelpContext.Provider value={{ available: true, openHelp }}>
      {children}
      {open ? <HelpDialog pathname={location.pathname} onClose={() => setOpen(false)} /> : null}
    </HelpContext.Provider>
  );
}

/** Rendered by `PageHeader`; a no-op outside the authenticated shell. */
export function HelpButton() {
  const { available, openHelp } = useHelp();
  if (!available) return null;
  return (
    <button
      type="button"
      className={styles.trigger}
      onClick={openHelp}
      title="Help for this screen (?)"
    >
      <CircleHelp size={14} aria-hidden="true" />
      Help
      <kbd className={styles.triggerKey} aria-hidden="true">
        ?
      </kbd>
    </button>
  );
}

function HelpDialog({ pathname, onClose }: { pathname: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const topic = topicForPath(pathname);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreRef.current?.focus();
    };
  }, [onClose]);

  return (
    <div
      className={styles.scrim}
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
      >
        <header className={styles.header}>
          <p className={styles.eyebrow}>This screen</p>
          <h2 id={titleId} className={styles.title}>
            {topic?.title ?? "Help"}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close help"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        {topic ? (
          <div className={styles.body}>
            <p className={styles.purpose}>{topic.purpose}</p>
            <h3 className={styles.sectionTitle}>What to do</h3>
            <ol className={styles.steps}>
              {topic.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {topic.rules?.length ? (
              <>
                <h3 className={styles.sectionTitle}>Rules this screen enforces</h3>
                <ul className={styles.rules}>
                  {topic.rules.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {topic.tips?.length ? (
              <div className={styles.tip}>
                {topic.tips.map((tip) => (
                  <p key={tip}>{tip}</p>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p className={styles.purpose}>
            This screen has no separate guide. The full help page covers every workflow.
          </p>
        )}

        <footer className={styles.footer}>
          <Link className={styles.allHelp} to="/help" onClick={onClose}>
            All help topics <ArrowRight size={13} aria-hidden="true" />
          </Link>
          <span className={styles.hint}>
            Press <kbd>?</kbd> on any screen
          </span>
        </footer>
      </div>
    </div>
  );
}
