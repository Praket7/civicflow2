import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { t } from "../../lib/i18n";
import { HelpButton } from "../help/HelpDialog";
import styles from "./ui.module.css";

type Width = "default" | "narrow" | "wide";

const widthClass: Record<Width, string> = {
  default: "",
  narrow: styles.pageNarrow,
  wide: styles.pageWide,
};

export function Page({
  children,
  width = "default",
  className,
}: {
  children: ReactNode;
  width?: Width;
  className?: string;
}) {
  return (
    <div className={[styles.page, widthClass[width], className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  backTo,
  backLabel,
  dot = true,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  backTo?: string;
  backLabel?: string;
  dot?: boolean;
}) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageHeaderCopy}>
        {backTo ? (
          <Link className={styles.backLink} to={backTo}>
            <ArrowLeft size={13} aria-hidden="true" />
            {backLabel ? t(backLabel) : t("Back")}
          </Link>
        ) : null}
        {eyebrow ? (
          <p className={styles.eyebrow}>
            {dot ? <span className={styles.eyebrowDot} aria-hidden="true" /> : null}
            {typeof eyebrow === "string" ? t(eyebrow) : eyebrow}
          </p>
        ) : null}
        <h1 className={styles.title}>{typeof title === "string" ? t(title) : title}</h1>
        {description ? (
          <p className={styles.subtitle}>
            {typeof description === "string" ? t(description) : description}
          </p>
        ) : null}
      </div>
      <div className={styles.headerActions}>
        <HelpButton />
        {actions}
      </div>
    </header>
  );
}
