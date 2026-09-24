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
  // "ambas" = la misma propiedad está en venta y en alquiler: el precio
  // principal es el de venta, y el de alquiler va aparte (priceAlquiler).
  const esVenta = row.operacion === "venta" || row.operacion === "ambas";
  const fotos = (row.propiedad_foto || []).slice().sort((a, b) => a.orden - b.orden);

  return {
    id: row.id,
    codigo: row.codigo,
    title: row.titulo_publico || `${typeLabel(row.tipo)} en ${row.barrio || row.localidad || "San Salvador de Jujuy"}`,
    operation: row.operacion,
    type: row.tipo,
    zone: row.barrio || row.localidad || "",
    address: row.ocultar_direccion
      ? (row.barrio || row.localidad || "")
      : [row.calle, row.numero].filter(Boolean).join(" ") || row.barrio || row.localidad || "",
    price: Dinero.aPesos(esVenta ? row.precio_venta : row.precio_alquiler) || 0,
    currency: (esVenta ? row.moneda_venta : row.moneda_alquiler) || "USD",
    priceAlquiler: row.operacion === "ambas" ? Dinero.aPesos(row.precio_alquiler) || 0 : null,
    currencyAlquiler: row.operacion === "ambas" ? row.moneda_alquiler || "ARS" : null,
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

function operationBadgeClass(op) {
  return { venta: "badge-venta", alquiler: "badge-alquiler", ambas: "badge-ambas" }[op] || "badge-temporal";
}

// Una propiedad "ambas" aparece tanto al filtrar por Venta como por Alquiler.
function matchesOperation(p, op) {
  if (!op || op === "todas") return true;
  if (p.operation === op) return true;
  return p.operation === "ambas" && (op === "venta" || op === "alquiler");
}

// Precios publicados de una propiedad: uno, o dos si es venta y alquiler.
function propertyPrices(p) {
  const lista = [{ price: p.price, currency: p.currency }];
  if (p.operation === "ambas" && p.priceAlquiler != null) lista.push({ price: p.priceAlquiler, currency: p.currencyAlquiler });
  return lista;
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
  const monto = (price, currency) => `${currency === "USD" ? "USD" : "$"} ${(price || 0).toLocaleString("es-AR")}`;
  if (p.operation === "ambas") {
    const alquiler = p.priceAlquiler ? ` · Alquiler ${monto(p.priceAlquiler, p.currencyAlquiler)} / mes` : "";
    return `${monto(p.price, p.currency)}${alquiler}`;
  }
  const suffix = p.operation === "temporal" ? " / noche" : p.operation === "alquiler" ? " / mes" : "";
  return `${monto(p.price, p.currency)}${suffix}`;
}

// Completa un <select> de barrios con los que tienen propiedades
// publicadas (además de los que ya trae el HTML), para que un barrio
// nuevo cargado desde el panel también se pueda filtrar.
function fillZoneSelect(select, properties) {
  if (!select) return;
  const existentes = new Set(Array.from(select.options).map((o) => o.value.toLowerCase()));
  const nuevas = [...new Set(properties.map((p) => p.zone).filter(Boolean))]
    .filter((z) => !existentes.has(z.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "es"));
  nuevas.forEach((z) => {
    const opt = document.createElement("option");
    opt.value = z;
    opt.textContent = z;
    select.appendChild(opt);
  });
  if (nuevas.length) select.dispatchEvent(new Event("change"));
}
