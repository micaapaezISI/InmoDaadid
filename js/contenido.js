/* =====================================================================
   PATRICIA DAADIN — Textos editables del sitio
   ---------------------------------------------------------------------
   Busca elementos con data-content-key="clave" y, si hay un valor
   guardado en la tabla contenido_sitio, reemplaza el texto. Si no hay
   fila o está vacía, se deja el texto que ya trae el HTML (fallback) —
   así el sitio nunca queda en blanco ni depende de que Supabase responda.
   Siempre usa textContent (nunca innerHTML) para no poder inyectar HTML.
   Ver supabase/migrations/015_contenido_sitio.sql.
   ===================================================================== */

async function aplicarContenidoEditable() {
  const nodos = document.querySelectorAll("[data-content-key]");
  if (nodos.length === 0) return;

  const claves = Array.from(new Set(Array.from(nodos).map((n) => n.dataset.contentKey)));
  const { data, error } = await supabaseClient.from("contenido_sitio").select("clave, valor").in("clave", claves);
  if (error || !data) return;

  const valores = {};
  data.forEach((fila) => {
    if (fila.valor && fila.valor.trim()) valores[fila.clave] = fila.valor;
  });

  nodos.forEach((nodo) => {
    const valor = valores[nodo.dataset.contentKey];
    if (valor) nodo.textContent = valor;
  });
}

document.addEventListener("DOMContentLoaded", aplicarContenidoEditable);
