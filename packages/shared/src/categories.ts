/** Categorías generales de producto (clasificación del catálogo). */
export const ProductCategory = {
  Shampoo: "Shampoo",
  Acondicionador: "Acondicionador",
  Tratamiento: "Tratamiento",
  Coloracion: "Coloración",
  Fijacion: "Fijación / styling",
  Aceites: "Aceites / serums",
  Maquillaje: "Maquillaje",
  CuidadoCorporal: "Cuidado corporal",
  Salud: "Salud / suplementos",
  Fragancias: "Fragancias",
  Accesorios: "Accesorios",
  Otros: "Otros",
} as const;
export type ProductCategory =
  (typeof ProductCategory)[keyof typeof ProductCategory];

export const PRODUCT_CATEGORIES = Object.values(ProductCategory);

/**
 * Mínimo de piezas disponibles por producto, según categoría.
 * Si el stock del producto baja de este número, el admin recibe alerta al entrar.
 * Calibrado con el inventario real (promedios y giro típico por línea).
 */
export const CATEGORY_MIN_STOCK: Record<ProductCategory, number> = {
  [ProductCategory.Shampoo]: 5,
  [ProductCategory.Acondicionador]: 5,
  [ProductCategory.Tratamiento]: 3,
  [ProductCategory.Coloracion]: 2,
  [ProductCategory.Fijacion]: 3,
  [ProductCategory.Aceites]: 3,
  [ProductCategory.Maquillaje]: 2,
  [ProductCategory.CuidadoCorporal]: 3,
  [ProductCategory.Salud]: 2,
  [ProductCategory.Fragancias]: 2,
  [ProductCategory.Accesorios]: 2,
  [ProductCategory.Otros]: 3,
};

export function minStockForCategory(category: string | null | undefined): number {
  if (!category) return CATEGORY_MIN_STOCK[ProductCategory.Otros];
  if (category in CATEGORY_MIN_STOCK) {
    return CATEGORY_MIN_STOCK[category as ProductCategory];
  }
  return CATEGORY_MIN_STOCK[ProductCategory.Otros];
}

/**
 * Clasifica un artículo por nombre + marca (Excel La Casa del Shampoo).
 */
export function classifyProductCategory(
  name: string,
  brand = "",
): ProductCategory {
  const n = name.toLowerCase();
  const b = brand.toLowerCase();

  if (/shampoo|champ[uú]/.test(n)) return ProductCategory.Shampoo;
  if (/acondicionador|conditioner/.test(n))
    return ProductCategory.Acondicionador;
  if (/tratamiento|keratina|botox|ampol|mascarilla|mask|hair.?mask/.test(n))
    return ProductCategory.Tratamiento;
  if (
    /tinte|igora|color|decolor|oxidante|revelador|bleach|matizador|arctic.?fox|artic.?fox/.test(
      n,
    ) ||
    b.includes("igora") ||
    b.includes("artic fox") ||
    b.includes("arctic fox")
  ) {
    return ProductCategory.Coloracion;
  }
  if (/gel|cera|spray|mousse|fijador|pomada|laca/.test(n))
    return ProductCategory.Fijacion;
  if (/aceite|serum|sérum|gotas|\boil\b/.test(n)) return ProductCategory.Aceites;
  if (
    /labial|lipstick|gloss|rimel|rímel|m[aá]scara de pesta|base |corrector|sombra|rubor|eyeliner|delineador|brocha|pincel|iluminador|contour|polvo|blush|primer|bb cream|cc cream|lipstick|lip /.test(
      n,
    ) ||
    b === "bissu"
  ) {
    return ProductCategory.Maquillaje;
  }
  if (
    /vitamina|c[aá]psula|jarabe|\bt[eé]\b|suplement|presi[oó]n|diabetes|colageno|colágeno/.test(
      n,
    ) ||
    b.includes("sana sano")
  ) {
    return ProductCategory.Salud;
  }
  if (
    /crema|loci[oó]n|body|corporal|anti.?celul|estr[ií]a|jab[oó]n|exfol|bloqueador|protector solar|hand|manos|pies/.test(
      n,
    )
  ) {
    return ProductCategory.CuidadoCorporal;
  }
  if (
    /perfume|fragancia|splash|body.?mist|colonia|italian.?deluxe/.test(n) ||
    b.includes("italian")
  ) {
    return ProductCategory.Fragancias;
  }
  if (/cepillo|peine|pinza|ligas|accesorio|guante|gorro|toalla/.test(n))
    return ProductCategory.Accesorios;

  return ProductCategory.Otros;
}
