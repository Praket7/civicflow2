import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { routes, searchRoutes } from "../../app/routes";
import type { RouteMeta } from "../../app/routes";
import { useAuth } from "../../lib/auth/session";
import { t } from "../../lib/i18n";
import { useHelp } from "../help/HelpDialog";
import styles from "./CommandPalette.module.css";

type PaletteItem = { kind: "help" } | { kind: "route"; route: RouteMeta };

const popular: Record<"coordinator" | "volunteer", string[]> = {
  coordinator: [
    "/coordinator/mission-control",
    "/coordinator/coverage",
    "/coordinator/schedule",
    "/coordinator/volunteers",
    "/coordinator/reports",
    "/coordinator/settings",
  ],
  volunteer: [
    "/volunteer/home",
    "/volunteer/discover",
    "/volunteer/schedule",
    "/volunteer/hours",
    "/volunteer/profile",
    "/coordinator/settings",
  ],
};

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

/** Mounted only while open so every session starts from a clean query. */
function PaletteDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const navigate = useNavigate();
  const listId = useId();
  const { user } = useAuth();
  const { openHelp } = useHelp();
  const role: "coordinator" | "volunteer" =
    user?.role === "coordinator" ? "coordinator" : "volunteer";

  const results = useMemo<PaletteItem[]>(() => {
    // Only screens this account can open, never parameterised paths.
    const visible = (route: RouteMeta) =>
      !route.path.includes(":") &&
      (route.role === role || route.id === "settings" || route.id === "accessibility");
    const helpMatches = !query.trim() || /help|guide|shortcut|keys/i.test(query);
    const help: PaletteItem[] = helpMatches ? [{ kind: "help" }] : [];
    if (!query.trim()) {
      const frequent = popular[role]
        .map((path) => routes.find((route) => route.path === path))
        .filter((route): route is RouteMeta => route !== undefined && visible(route));
      return [...help, ...frequent.map((route) => ({ kind: "route" as const, route }))];
    }
    return [
      ...help,
      ...searchRoutes(query)
        .filter(visible)
        .map((route) => ({ kind: "route" as const, route })),
    ];
  }, [query, role]);

  const active = results[activeIndex];
  const activeId =
    active?.kind === "help" ? "command-help" : active ? `command-${active.route.id}` : undefined;

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      if (dialog?.open) dialog.close();
      restoreRef.current?.focus();
    };
  }, []);

  function close() {
    onClose();
  }

  function choose(index: number) {
    const item = results[index];
    if (!item) return;
    close();
    if (item.kind === "help") {
      openHelp();
      return;
    }
    navigate(item.route.path);
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-label="Search CivicFlow"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className={styles.searchRow}>
        <Search size={18} strokeWidth={1.8} aria-hidden="true" />
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          placeholder="Search screens, volunteers, actions…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => Math.min(index + 1, results.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(activeIndex);
            }
          }}
        />
        <kbd className={styles.esc}>Esc</kbd>
      </div>

      <div className={styles.results}>
        <p className={styles.groupLabel}>{query.trim() ? "Matching surfaces" : "Jump to"}</p>
        {results.length === 0 ? (
          <p className={styles.empty}>
            No surface matches “{query.trim()}”. Try “coverage” or “hours”.
          </p>
        ) : (
          <ul role="listbox" id={listId} aria-label="Search results">
            {results.map((item, index) => {
              const id = item.kind === "help" ? "command-help" : `command-${item.route.id}`;
              return (
                <li
                  key={id}
                  id={id}
                  role="option"
                  aria-selected={index === activeIndex}
                  tabIndex={-1}
                  className={styles.option}
                  onPointerMove={() => setActiveIndex(index)}
                  onClick={() => choose(index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") choose(index);
                  }}
                >
                  {item.kind === "help" ? (
                    <>
                      <span className={styles.number}>?</span>
                      <span className={styles.optionText}>
                        <span className={styles.optionTitle}>{t("Help for this screen (?)")}</span>
                        <span className={styles.optionSpec}>{t("Help and guides")}</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className={styles.number}>
                        {String(item.route.number).padStart(2, "0")}
                      </span>
                      <span className={styles.optionText}>
                        <span className={styles.optionTitle}>{t(item.route.title)}</span>
                        <span className={styles.optionSpec}>{t(item.route.spec)}</span>
                      </span>
                    </>
                  )}
                  {index === activeIndex ? (
                    <CornerDownLeft size={15} className={styles.enter} aria-hidden="true" />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <footer className={styles.footer}>
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> to move
        </span>
        <span>
          <kbd>↵</kbd> to open
        </span>
        <span>
          <kbd>Esc</kbd> to close
        </span>
      </footer>
    </dialog>
  );
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  return open ? <PaletteDialog onClose={onClose} /> : null;
}
