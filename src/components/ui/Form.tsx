import { useId } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { Search } from "lucide-react";
import { t } from "../../lib/i18n";
import styles from "./ui.module.css";

function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className={styles.error} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** The message that explains the field is the one the input points at. */
function describedBy(
  id: string,
  error: ReactNode,
  hint: ReactNode,
  existing: string | undefined,
): string | undefined {
  const message = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return [existing, message].filter(Boolean).join(" ") || undefined;
}

export function TextField({
  label,
  hint,
  error,
  id,
  "aria-describedby": describedById,
  ...rest
}: { label: string; hint?: ReactNode; error?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      <input
        {...rest}
        id={inputId}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, error, hint, describedById)}
      />
    </Field>
  );
}

export function TextareaField({
  label,
  hint,
  error,
  id,
  "aria-describedby": describedById,
  ...rest
}: {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      <textarea
        {...rest}
        id={inputId}
        className={styles.textarea}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, error, hint, describedById)}
      />
    </Field>
  );
}

export function SelectField({
  label,
  hint,
  error,
  id,
  children,
  "aria-describedby": describedById,
  ...rest
}: {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      <select
        {...rest}
        id={inputId}
        className={styles.select}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, error, hint, describedById)}
      >
        {children}
      </select>
    </Field>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder = "Search…",
  label = "Search",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}) {
  const id = useId();
  return (
    <div className={styles.search}>
      <label className="visually-hidden" htmlFor={id}>
        {label}
      </label>
      <Search className={styles.searchIcon} size={14} aria-hidden="true" />
      <input
        id={id}
        type="search"
        className={`${styles.input} ${styles.searchInput}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

export function CheckboxField({
  label,
  hint,
  ...rest
}: { label: ReactNode; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={styles.checkRow}>
      <input type="checkbox" className={styles.checkbox} {...rest} />
      <span>
        <span>{label}</span>
        {hint ? <span className={styles.hint}>{hint}</span> : null}
      </span>
    </label>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleCopy}>
        <div className={styles.toggleTitle}>{t(label)}</div>
        {hint ? <div className={styles.toggleHint}>{t(hint)}</div> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={t(label)}
        className={styles.switch}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}
