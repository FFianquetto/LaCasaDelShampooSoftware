import type { ChangeEvent, ReactNode, SelectHTMLAttributes } from "react";

type SelectFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  className?: string;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange" | "children" | "className">;

/** Desplegable con el mismo estilo en todo el ticket (y formularios). */
export function SelectField({
  label,
  value,
  onChange,
  children,
  className,
  ...rest
}: SelectFieldProps) {
  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    onChange(event.target.value);
  }

  return (
    <div className={`form-row select-field${className ? ` ${className}` : ""}`}>
      <label>{label}</label>
      <select value={value} onChange={handleChange} {...rest}>
        {children}
      </select>
    </div>
  );
}
