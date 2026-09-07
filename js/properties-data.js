/* =====================================================================
   PATRICIA DAADIN — datos de propiedades (Supabase)
   ---------------------------------------------------------------------
   PROPERTIES se llena en tiempo de ejecución consultando la tabla
   "properties" de Supabase (ver supabase/schema.sql). Las páginas que
   necesitan la lista deben llamar a `await fetchProperties()` antes de
   renderizar.
   ===================================================================== */

let PROPERTIES = [];

async function fetchProperties() {
  const { data, error } = await supabaseClient
    .from("properties")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("No se pudieron cargar las propiedades:", error);
    PROPERTIES = [];
    return PROPERTIES;
  }

  PROPERTIES = data || [];
  return PROPERTIES;
}

/* ---------------------------------------------------------------------
   Helper: genera una "foto" placeholder en SVG (gradiente + ícono) para
   las propiedades que todavía no tienen fotos cargadas.
   seed determina el color; label es el texto que se muestra.
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
  return { venta: "Venta", alquiler: "Alquiler", temporal: "Temporario" }[op] || op;
}

function typeLabel(t) {
  return (
    { casa: "Casa", departamento: "Departamento", terreno: "Terreno", local: "Local comercial" }[t] || t
  );
}

function formatPrice(p) {
  const amount = p.currency === "USD" ? p.price.toLocaleString("es-AR") : p.price.toLocaleString("es-AR");
  const suffix = p.operation === "temporal" ? " / noche" : p.operation === "alquiler" ? " / mes" : "";
  return `${p.currency === "USD" ? "USD" : "$"} ${amount}${suffix}`;
}
