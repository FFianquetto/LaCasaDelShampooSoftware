type Props = {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
};

/** Solo dígitos y un punto decimal (máx. 2 decimales). Sin letras ni signos. */
export function sanitizeMoneyDigits(raw: string): string {
  let cleaned = raw.replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot !== -1) {
    const head = cleaned.slice(0, firstDot + 1);
    const tail = cleaned.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
    cleaned = head + tail;
  }
  if (cleaned.startsWith(".")) cleaned = `0${cleaned}`;
  return cleaned;
}

export function parseMoneyInput(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export function MoneyInput({
  value,
  onChange,
  required,
  disabled,
  placeholder = "0.00",
  id,
  "aria-label": ariaLabel,
}: Props) {
  return (
    <div className={`money-input${disabled ? " disabled" : ""}`}>
      <span className="money-prefix" aria-hidden="true">
        $
      </span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(sanitizeMoneyDigits(event.target.value))}
        onKeyDown={(event) => {
          if (event.key === "-" || event.key === "+" || event.key === "e" || event.key === "E") {
            event.preventDefault();
          }
        }}
      />
    </div>
  );
}
