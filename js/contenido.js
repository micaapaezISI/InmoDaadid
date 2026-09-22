/* =====================================================================
   PATRICIA DAADIN — Textos editables del sitio
   ---------------------------------------------------------------------
   Busca elementos con data-content-key="clave" y, si hay una fila
   guardada en la tabla contenido_sitio, reemplaza el texto (y aplica
   color/tipografía si se cargaron). Si no hay fila o el texto está
   vacío, se deja el texto que ya trae el HTML (fallback) — así el
   sitio nunca queda en blanco ni depende de que Supabase responda.
   Siempre usa textContent (nunca innerHTML) para no poder inyectar HTML.
   Ver supabase/migrations/015_contenido_sitio.sql y 016 (color/fuente).
   ===================================================================== */

const CONTENIDO_FUENTES = {
  sora: "var(--font-heading)",
  mulish: "var(--font-body)",
};

async function aplicarContenidoEditable() {
  const nodos = document.querySelectorAll("[data-content-key]");
  if (nodos.length === 0) return;

  const claves = Array.from(new Set(Array.from(nodos).map((n) => n.dataset.contentKey)));
  const { data, error } = await supabaseClient.from("contenido_sitio").select("clave, valor, color, fuente").in("clave", claves);
  if (error || !data) return;

  const filas = {};
  data.forEach((fila) => {
    if (fila.valor && fila.valor.trim()) filas[fila.clave] = fila;
  });

  nodos.forEach((nodo) => {
    const fila = filas[nodo.dataset.contentKey];
    if (!fila) return;
    nodo.textContent = fila.valor;
    nodo.style.color = fila.color || "";
    nodo.style.fontFamily = CONTENIDO_FUENTES[fila.fuente] || "";
  });
}

document.addEventListener("DOMContentLoaded", aplicarContenidoEditable);
