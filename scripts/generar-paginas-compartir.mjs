/* =====================================================================
   PATRICIA DAADIN — páginas para compartir cada propiedad
   ---------------------------------------------------------------------
   WhatsApp/Facebook arman la vista previa de un link leyendo las
   etiquetas og: del HTML SIN ejecutar JavaScript. propiedad.html?id=N
   es la misma página para todas (se completa con JS), así que siempre
   mostraba la foto genérica del sitio.

   Este script genera, por cada propiedad publicada, una página estática
   /p/<id>/index.html con su título, precio y foto de portada en las
   etiquetas og:, que al abrirla una persona la manda a la ficha real.
   Lo corre la GitHub Action .github/workflows/paginas-compartir.yml
   (cada 15 minutos y a mano), y solo commitea si algo cambió.

   Uso local:  node scripts/generar-paginas-compartir.mjs
   ===================================================================== */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SALIDA = path.join(RAIZ, "p");
const DOMINIO = "https://" + fs.readFileSync(path.join(RAIZ, "CNAME"), "utf8").trim();

// Mismos datos públicos que usa el sitio (js/supabase-config.js).
const config = fs.readFileSync(path.join(RAIZ, "js", "supabase-config.js"), "utf8");
const SUPABASE_URL = /SUPABASE_URL\s*=\s*"([^"]+)"/.exec(config)[1];
const SUPABASE_KEY = /SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/.exec(config)[1];

// Por encima de este peso, la portada se achica (WhatsApp puede no mostrar
// la vista previa grande con imágenes pesadas).
const MAX_BYTES_IMAGEN = 300 * 1024;

const TIPOS = {
  casa: "Casa", departamento: "Departamento", terreno: "Terreno", local: "Local comercial",
  oficina: "Oficina", galpon: "Galpón", cochera: "Cochera", campo: "Campo", otro: "Propiedad",
};
const OPERACIONES = { venta: "Venta", alquiler: "Alquiler", temporal: "Alquiler temporario", ambas: "Venta y alquiler" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const monto = (centavos, moneda) => `${moneda === "USD" ? "USD" : "$"} ${(Number(centavos || 0) / 100).toLocaleString("es-AR")}`;

function precioTexto(p) {
  const venta = monto(p.precio_venta, p.moneda_venta);
  const alquiler = `${monto(p.precio_alquiler, p.moneda_alquiler)}${p.operacion === "temporal" ? " / noche" : " / mes"}`;
  if (p.operacion === "venta") return venta;
  if (p.operacion === "ambas") return `${venta} · Alquiler ${alquiler}`;
  return alquiler;
}

function titulo(p) {
  return p.titulo_publico || `${TIPOS[p.tipo] || "Propiedad"} en ${p.barrio || p.localidad || "San Salvador de Jujuy"}`;
}

function descripcion(p) {
  const datos = [
    `${OPERACIONES[p.operacion] || ""}: ${precioTexto(p)}`,
    p.dormitorios ? `${p.dormitorios} dorm.` : "",
    p.superficie_total ? `${p.superficie_total} m² tot.` : "",
    p.superficie_cubierta ? `${p.superficie_cubierta} m² cub.` : "",
    [p.barrio, p.localidad].filter(Boolean).join(", "),
  ].filter(Boolean).join(" · ");
  return datos.slice(0, 200);
}

async function obtenerPropiedades() {
  const url = `${SUPABASE_URL}/rest/v1/propiedades?select=*,propiedad_foto(url,orden)&publicar_web=eq.true&activo=eq.true`;
  const res = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
  if (!res.ok) throw new Error(`Supabase respondió ${res.status}: ${await res.text()}`);
  return res.json();
}

// Devuelve la URL de imagen para og:image: la foto original si es liviana,
// o una copia achicada guardada en /p/<id>/portada.jpg.
async function imagenPortada(p, carpeta, manifiestoAnterior) {
  const fotos = (p.propiedad_foto || []).slice().sort((a, b) => a.orden - b.orden);
  const local = path.join(carpeta, "portada.jpg");
  if (!fotos.length) {
    fs.rmSync(local, { force: true });
    return { url: `${DOMINIO}/img/hero/jujuy-calle.jpg`, fuente: null };
  }
  const original = fotos[0].url;
  const previo = manifiestoAnterior[p.id];
  if (previo && previo.fuente === original) {
    return { url: previo.url, fuente: original, ancho: previo.ancho, alto: previo.alto };
  }

  const res = await fetch(original);
  if (!res.ok) return { url: original, fuente: original };
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length <= MAX_BYTES_IMAGEN) {
    fs.rmSync(local, { force: true });
    return { url: original, fuente: original };
  }
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    console.warn(`  (sin "sharp" instalado: p/${p.id} usa la portada original de ${Math.round(buffer.length / 1024)} KB)`);
    return { url: original, fuente: null };
  }
  await sharp(buffer).rotate().resize(1200, 630, { fit: "cover" }).jpeg({ quality: 78 }).toFile(local);
  return { url: `${DOMINIO}/p/${p.id}/portada.jpg`, fuente: original, ancho: 1200, alto: 630 };
}

function paginaHTML(p, img) {
  const t = esc(titulo(p));
  const d = esc(descripcion(p));
  const destino = `/propiedad.html?id=${p.id}`;
  const urlPropia = `${DOMINIO}/p/${p.id}/`;
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${t} — Patricia Daadin</title>
<meta name="description" content="${d}">
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="${DOMINIO}${destino}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Patricia Daadin — Martillera">
<meta property="og:locale" content="es_AR">
<meta property="og:url" content="${urlPropia}">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${esc(img.url)}">
<meta property="og:image:secure_url" content="${esc(img.url)}">
${img.ancho ? `<meta property="og:image:width" content="${img.ancho}">\n<meta property="og:image:height" content="${img.alto}">\n` : ""}<meta property="og:image:alt" content="${t}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${esc(img.url)}">
<script>location.replace(${JSON.stringify(destino)} + location.hash);</script>
</head>
<body style="font-family:sans-serif; padding:40px; text-align:center;">
<p><a href="${destino}">Ver ${t}</a></p>
</body>
</html>
`;
}

async function main() {
  const propiedades = await obtenerPropiedades();
  fs.mkdirSync(SALIDA, { recursive: true });
  const rutaManifiesto = path.join(SALIDA, "manifiesto.json");
  let anterior = {};
  try { anterior = JSON.parse(fs.readFileSync(rutaManifiesto, "utf8")); } catch {}

  const manifiesto = {};
  for (const p of propiedades) {
    const carpeta = path.join(SALIDA, String(p.id));
    fs.mkdirSync(carpeta, { recursive: true });
    const img = await imagenPortada(p, carpeta, anterior);
    fs.writeFileSync(path.join(carpeta, "index.html"), paginaHTML(p, img));
    manifiesto[p.id] = img;
    console.log(`p/${p.id}/  ${titulo(p)}  →  ${img.url}`);
  }

  // Las que se despublicaron o desactivaron: se borra su página (el link
  // viejo cae en 404.html, que igual manda a la ficha "ya no disponible").
  for (const nombre of fs.readdirSync(SALIDA)) {
    if (/^\d+$/.test(nombre) && !manifiesto[nombre]) {
      fs.rmSync(path.join(SALIDA, nombre), { recursive: true, force: true });
      console.log(`p/${nombre}/  borrada (ya no está publicada)`);
    }
  }
  fs.writeFileSync(rutaManifiesto, JSON.stringify(manifiesto, null, 2) + "\n");
  console.log(`${propiedades.length} páginas para compartir.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
