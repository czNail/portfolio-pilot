import { useEffect, useRef, useState, type ReactNode } from "react";
import { parseNumberInput } from "./domain/input";
export const money = (n: number) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
export const pct = (n: number) => `${n.toFixed(2)}%`;
export const colors = [
  "#397faa",
  "#69a999",
  "#c9a35e",
  "#a48dba",
  "#d68e73",
  "#7daab6",
  "#a3ae6c",
  "#b97b93",
];
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    overview: "M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z",
    assets: "M3 8h18v12H3V8Zm2-4h14v4H5V4Zm12 10h4",
    plan: "m4 7 4 4 8-8M4 17h16M12 7h8",
    risk: "m12 3 9 4v6c0 4-5 7-9 9-4-2-9-5-9-9V7l9-4Zm0 5v5m0 4h.01",
    data: "M4 3h13l3 3v15H4V3Zm3 0v7h10V3M8 21v-7h8v7",
    arrow: "M4 12h16m-6-6 6 6-6 6",
    external: "M7 17 17 7M7 7h10v10",
    plus: "M12 5v14M5 12h14",
    moon: "M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z",
    sun: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
    upload: "M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5",
    check: "m5 12 4 4L19 6",
    close: "m6 6 12 12M6 18 18 6",
    edit: "m15 4 5 5M3 21l5-1L21 7l-5-5L3 15v6Z",
    reset: "M3 10a9 9 0 1 1 2 9M3 4v6h6",
    info: "M12 11v6m0-10h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.info} />
    </svg>
  );
}
export function NumberField({
  label,
  value,
  onChange,
  suffix = "元",
  nullable = false,
  min = 0,
  max,
  step = "0.01",
  help,
  emptyZero = false,
  placeholder,
  hideLabel = false,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  suffix?: string;
  nullable?: boolean;
  min?: number;
  max?: number;
  step?: string;
  help?: string;
  emptyZero?: boolean;
  placeholder?: string;
  hideLabel?: boolean;
}) {
  const display = (v: number | null) =>
    v === null || (emptyZero && v === 0) ? "" : String(v);
  const [text, setText] = useState(() => display(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current && Number.isFinite(value ?? 0))
      setText(display(value));
  }, [value, emptyZero]);
  return (
    <label className="field">
      <span className={hideLabel ? "visually-hidden" : undefined}>{label}</span>
      <div className="input-shell">
        <input
          type="text"
          inputMode={step === "1" ? "numeric" : "decimal"}
          aria-invalid={
            (value !== null && !Number.isFinite(value)) || undefined
          }
          value={text}
          placeholder={placeholder ?? (nullable ? "不限" : "0")}
          onFocus={(e) => {
            focused.current = true;
            e.currentTarget.select();
          }}
          onBlur={() => {
            focused.current = false;
            if (Number.isFinite(value ?? 0)) setText(display(value));
          }}
          onChange={(e) => {
            setText(e.target.value);
            onChange(parseNumberInput(e.target.value, nullable));
          }}
        />
        <span>{suffix}</span>
      </div>
      {help && <small>{help}</small>}
    </label>
  );
}
export function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-heading">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      className="modal"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-btn"
          aria-label="关闭对话框"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
