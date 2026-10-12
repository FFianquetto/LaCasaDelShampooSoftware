export function StoreName({ name, dot = false }: { name: string; dot?: boolean }) {
  return <span className="store-name">{dot ? `${name}.` : name}</span>;
}
