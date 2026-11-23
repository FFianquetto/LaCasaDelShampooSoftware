import { SelectField } from "./SelectField";

export type ProductSelectItem = {
  id: string;
  code?: string | null;
  sku?: string | null;
  name: string;
};

type ProductSelectProps = {
  label?: string;
  value: string;
  products: ProductSelectItem[];
  onChange: (productId: string) => void;
  className?: string;
  /** Si true, value/onChange usan el código (ID visible) en vez del id interno. */
  byCode?: boolean;
  placeholder?: string;
  disabled?: boolean;
};

function sortKey(item: ProductSelectItem): string {
  return (item.code ?? item.sku ?? "").toString();
}

function optionValue(item: ProductSelectItem, byCode: boolean): string {
  if (byCode) return item.code ?? "";
  return item.id;
}

function optionLabel(item: ProductSelectItem): string {
  const code = item.code ?? item.sku ?? "—";
  return `${code} — ${item.name}`;
}

/** Selector de producto reutilizable (Inventario, Precios, etc.). */
export function ProductSelect({
  label = "Producto",
  value,
  products,
  onChange,
  className,
  byCode = false,
  placeholder = "Selecciona ID y producto…",
  disabled,
}: ProductSelectProps) {
  const options = [...products]
    .filter((item) => (byCode ? Boolean(item.code) : true))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b), "es"));

  return (
    <SelectField
      label={label}
      value={value}
      className={className}
      disabled={disabled || options.length === 0}
      onChange={onChange}
    >
      <option value="">
        {options.length === 0 ? "Sin productos" : placeholder}
      </option>
      {options.map((item) => {
        const key = optionValue(item, byCode) || item.id;
        return (
          <option key={item.id} value={key}>
            {optionLabel(item)}
          </option>
        );
      })}
    </SelectField>
  );
}
