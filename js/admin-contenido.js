/* =====================================================================
   PATRICIA DAADIN — Panel admin: Textos del sitio
   ---------------------------------------------------------------------
   Edita los bloques de texto de la web pública (tabla contenido_sitio),
   sin tocar código. Mismo patrón que admin-configuracion.js. El HTML
   público los lee con js/contenido.js — ver
   supabase/migrations/015_contenido_sitio.sql para la lista de claves.
   ===================================================================== */

const AdminContenido = (() => {
  const CLAVES = ["home_hero_titulo", "home_hero_texto", "nosotros_historia_p1", "nosotros_historia_p2"];
  const form = document.getElementById("contenido-sitio-form");
  const guardadoEl = document.getElementById("contenido-sitio-guardado");

  async function loadContenido() {
    const { data, error } = await supabaseClient.from("contenido_sitio").select("clave, valor").in("clave", CLAVES);
    if (error) return;
    (data || []).forEach((fila) => {
      if (form.elements[fila.clave]) form.elements[fila.clave].value = fila.valor;
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const filas = CLAVES.map((clave) => ({ clave, valor: (data.get(clave) || "").trim() }));

    if (filas.some((f) => !f.valor)) {
      return avisar("Ningún campo puede quedar vacío — si un campo queda en blanco, se rompe esa parte de la web.", "error");
    }

    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;

    const { error } = await supabaseClient.from("contenido_sitio").upsert(filas);

    submitBtn.disabled = false;

    if (error) return avisar("No se pudo guardar: " + error.message, "error");

    avisar("Textos guardados. Ya se ven así en la web.");
    if (guardadoEl) {
      guardadoEl.style.display = "inline";
      setTimeout(() => { guardadoEl.style.display = "none"; }, 3000);
    }
  });

  return {
    init() { loadContenido(); },
    loadContenido,
  };
})();
