import { cx } from "../../../ui/cx";

const INPUT = "h-9 w-full min-w-0 bg-paper px-2.5 font-mono text-[12.5px] text-ink outline-none px-frame-thin focus-visible:outline-dashed focus-visible:outline-4 focus-visible:outline-offset-[3px] focus-visible:outline-signal";

export function TextField({ label, value, onChange, placeholder, type = "text", hint, className }: { readonly label: string; readonly value: string; readonly onChange: (next: string) => void; readonly placeholder?: string; readonly type?: string; readonly hint?: string | null; readonly className?: string }) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1", className)}>
      <span className="font-tag text-[10px] uppercase tracking-[0.04em] text-ink-2">{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className={INPUT} autoComplete="off" spellCheck={false} />
      {hint ? <span className="text-[11px] text-ink-3">{hint}</span> : null}
    </label>
  );
}

export function SelectField({ label, value, onChange, options, className }: { readonly label: string; readonly value: string; readonly onChange: (next: string) => void; readonly options: readonly (readonly [string, string])[]; readonly className?: string }) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1", className)}>
      <span className="font-tag text-[10px] uppercase tracking-[0.04em] text-ink-2">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={INPUT}>
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AreaField({ label, value, onChange, placeholder, rows = 4, hint }: { readonly label: string; readonly value: string; readonly onChange: (next: string) => void; readonly placeholder?: string; readonly rows?: number; readonly hint?: string | null }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="font-tag text-[10px] uppercase tracking-[0.04em] text-ink-2">{label}</span>
      <textarea rows={rows} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className={cx(INPUT, "h-auto py-2")} spellCheck={false} />
      {hint ? <span className="text-[11px] text-ink-3">{hint}</span> : null}
    </label>
  );
}
