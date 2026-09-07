/* =====================================================================
   PATRICIA DAADIN — datos de propiedades (Supabase)
   ---------------------------------------------------------------------
   Desde la Fase 1 del panel CRM, la tabla real es "propiedades" (esquema
   en español, heredado de InmoGestion — ver supabase/migrations/002_*.sql),
   no la vieja "properties". fetchProperties() traduce cada fila al mismo
   formato que ya usaban properties.js/property-detail.js (title, operation,
   type, price, currency, address, zone...) para no tener que reescribir
   esas páginas en esta fase.
   ===================================================================== */

let PROPERTIES = [];

function mapPropiedad(row) {
  const esVenta = row.operacion === "venta";
  const fotos = (row.propiedad_foto || []).slice().sort((a, b) => a.orden - b.orden);

  return {
    id: row.id,
    codigo: row.codigo,
    title: row.titulo_publico || `${typeLabel(row.tipo)} en ${row.barrio || row.localidad || "San Salvador de Jujuy"}`,
    operation: row.operacion,
    type: row.tipo,
    zone: row.barrio,
    address: row.ocultar_direccion
      ? (row.barrio || row.localidad || "")
      : [row.calle, row.numero].filter(Boolean).join(" ") || row.barrio || "",
    price: Dinero.aPesos(esVenta ? row.precio_venta : row.precio_alquiler) || 0,
    currency: (esVenta ? row.moneda_venta : row.moneda_alquiler) || "USD",
    bedrooms: row.dormitorios || 0,
    bathrooms: row.banos || 0,
    area: row.superficie_total || 0,
    featured: row.featured,
    active: row.activo,
    description: row.descripcion_publica || row.descripcion || "",
    amenities: row.amenities || [],
    images: fotos.map((f) => f.url),
  };
}

async function fetchProperties() {
  const { data, error } = await supabaseClient
    .from("propiedades")
    .select("*, propiedad_foto(url, orden, es_portada)")
    .eq("publicar_web", true)
    .eq("activo", true)
    .order("creado_en", { ascending: false });

  if (error) {
    console.error("No se pudieron cargar las propiedades:", error);
    PROPERTIES = [];
    return PROPERTIES;
  }

  PROPERTIES = (data || []).map(mapPropiedad);
  return PROPERTIES;
}

/* ---------------------------------------------------------------------
   Helper: genera una "foto" placeholder en SVG para las propiedades que
   todavía no tienen fotos cargadas. seed determina el color; label es el
   texto que se muestra.
   --------------------------------------------------------------------- */
const PH_PALETTES = [
  "#b98a68", // arcilla / adobe al sol
  "#a67d79", // rosa polvoroso (flamencos de Pozuelos)
  "#a3987a", // piedra / arena del altiplano
  "#a9ad8f", // salvia pálida (yareta y tola)
  "#a08e91", // malva pálido (cielo puneño al atardecer)
  "#b89c73", // arena tostada clara
];

function placeholderPhotoSVG(seed, label) {
  const fill = PH_PALETTES[seed % PH_PALETTES.length];
  return `
  <svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
    <rect width="400" height="300" fill="${fill}"/>
    <line x1="0" y1="0" x2="400" y2="300" stroke="#f6f3ea" stroke-opacity="0.25" stroke-width="1"/>
    <line x1="400" y1="0" x2="0" y2="300" stroke="#f6f3ea" stroke-opacity="0.25" stroke-width="1"/>
    <text x="24" y="264" fill="#f6f3ea" font-family="IBM Plex Mono, monospace" font-size="13" letter-spacing="0.5">${label}</text>
    <text x="24" y="282" fill="#f6f3ea" fill-opacity="0.65" font-family="IBM Plex Mono, monospace" font-size="10">Sin fotos cargadas todavía</text>
  </svg>`;
}

function propertyMediaHTML(p, label) {
  if (p.images && p.images.length > 0) {
    return `<img src="${p.images[0]}" alt="${p.title}" loading="lazy">`;
  }
  return placeholderPhotoSVG(p.id % PH_PALETTES.length, label);
}

function operationLabel(op) {
  return { venta: "Venta", alquiler: "Alquiler", temporal: "Temporario", ambas: "Venta / Alquiler" }[op] || op;
}

function typeLabel(t) {
  return (
    {
      casa: "Casa", departamento: "Departamento", terreno: "Terreno", local: "Local comercial",
      oficina: "Oficina", galpon: "Galpón", cochera: "Cochera", campo: "Campo", otro: "Propiedad",
    }[t] || t
  );
}

function formatPrice(p) {
  const amount = p.price.toLocaleString("es-AR");
  const suffix = p.operation === "temporal" ? " / noche" : p.operation === "alquiler" ? " / mes" : "";
  return `${p.currency === "USD" ? "USD" : "$"} ${amount}${suffix}`;
}
