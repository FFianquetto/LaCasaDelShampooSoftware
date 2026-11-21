import { useEffect, useId, useState } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
};

/** YYYY-MM-DD → dd/mm/aaaa */
export function isoToMx(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}

/** dd/mm/aaaa → YYYY-MM-DD o null si incompleto/inválido */
export function mxToIso(mx: string): string | null {
  const match = mx.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function maskMxDate(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** Fecha en formato mexicano dd/mm/aaaa; value interno YYYY-MM-DD. */
export function DateInput({
  value,
  onChange,
  required,
  disabled,
  "aria-label": ariaLabel,
}: Props) {
  const pickerId = useId();
  const [text, setText] = useState(isoToMx(value));

  useEffect(() => {
    setText(isoToMx(value));
  }, [value]);

  return (
    <div className={`date-input${disabled ? " disabled" : ""}`}>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        placeholder="dd/mm/aaaa"
        required={required}
        disabled={disabled}
        aria-label={ariaLabel}
        value={text}
        onChange={(event) => {
          const next = maskMxDate(event.target.value);
          setText(next);
          if (next === "") {
            onChange("");
            return;
          }
          const iso = mxToIso(next);
          if (iso) onChange(iso);
        }}
        onBlur={() => {
          if (text === "") {
            onChange("");
            return;
          }
          const iso = mxToIso(text);
          if (iso) {
            onChange(iso);
            setText(isoToMx(iso));
          } else if (value) {
            setText(isoToMx(value));
          }
        }}
      />
      <label className="date-input-picker" htmlFor={pickerId} title="Calendario">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3V2zm12 8H5v9h14v-9zm0-2V6H5v2h14z"
          />
        </svg>
        <input
          id={pickerId}
          type="date"
          disabled={disabled}
          value={value}
          tabIndex={-1}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </div>
  );
}
