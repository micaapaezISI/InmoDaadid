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
  ["#ddc2a4", "#b98a68"], // arcilla / adobe al sol
  ["#dbb8b4", "#a67d79"], // rosa polvoroso (flamencos de Pozuelos)
  ["#d3c6a6", "#a3987a"], // piedra / arena del altiplano
  ["#c3c7ab", "#a9ad8f"], // salvia pálida (yareta y tola)
  ["#cbbabd", "#a08e91"], // malva pálido (cielo puneño al atardecer)
  ["#e0cba3", "#b89c73"], // arena tostada clara
];

function placeholderPhotoSVG(seed, label) {
  const pal = PH_PALETTES[seed % PH_PALETTES.length];
  const gid = `g${seed}-${Math.random().toString(36).slice(2, 7)}`;
  return `
  <svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${pal[0]}"/>
        <stop offset="100%" stop-color="${pal[1]}"/>
      </linearGradient>
    </defs>
    <rect width="400" height="300" fill="url(#${gid})"/>
    <g opacity="0.85" transform="translate(200,128)">
      <path d="M-38 8 L0 -28 L38 8 L38 42 L-38 42 Z" fill="none" stroke="#faf3ea" stroke-width="4" stroke-linejoin="round"/>
      <rect x="-10" y="16" width="20" height="26" fill="#faf3ea" opacity="0.9"/>
    </g>
    <text x="200" y="200" text-anchor="middle" fill="#faf3ea" font-family="Poppins, sans-serif" font-size="15" opacity="0.9">${label}</text>
    <text x="200" y="222" text-anchor="middle" fill="#faf3ea" font-family="Inter, sans-serif" font-size="11" opacity="0.6">Sin fotos cargadas todavía</text>
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
