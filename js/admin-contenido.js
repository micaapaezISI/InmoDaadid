/* =====================================================================
   PATRICIA DAADIN — Panel admin: Textos del sitio
   ---------------------------------------------------------------------
   Edita los bloques de texto de la web pública (tabla contenido_sitio),
   con color y tipografía opcionales por bloque, sin tocar código. El
   HTML público los lee con js/contenido.js — ver
   supabase/migrations/015_contenido_sitio.sql y
   supabase/migrations/016_contenido_sitio_estilos.sql.
   ===================================================================== */

const AdminContenido = (() => {
  const CAMPOS = [
    { clave: "home_hero_titulo", label: "Home — Título grande (primera parte, antes de la frase en rojo)", rows: 2 },
    { clave: "home_hero_titulo_resaltado", label: "Home — Frase resaltada en rojo, al final del título", rows: 1 },
    { clave: "home_hero_texto", label: "Home — Texto debajo del título", rows: 3 },
    { clave: "nosotros_historia_p1", label: 'Nosotros — "Mi historia", primer párrafo', rows: 4 },
    { clave: "nosotros_historia_p2", label: 'Nosotros — "Mi historia", segundo párrafo', rows: 4 },
  ];

  const contenedor = document.getElementById("contenido-sitio-campos");
  const form = document.getElementById("contenido-sitio-form");
  const guardadoEl = document.getElementById("contenido-sitio-guardado");

  function renderCampos() {
    contenedor.innerHTML = CAMPOS.map(
      (c) => `
      <div class="field admin-content-field">
        <label for="ct-${c.clave}">${c.label}</label>
        <textarea id="ct-${c.clave}" rows="${c.rows}"></textarea>
        <div class="admin-content-style-row">
          <label class="admin-content-color-toggle">
            <input type="checkbox" id="ct-${c.clave}-color-on">
            Color personalizado
          </label>
          <input type="color" id="ct-${c.clave}-color" value="#c40202" disabled>
          <label class="admin-content-font-label">
            Tipografía
            <select id="ct-${c.clave}-fuente">
              <option value="">Original</option>
              <option value="sora">Redondeada (títulos)</option>
              <option value="mulish">Normal (texto)</option>
            </select>
          </label>
        </div>
      </div>`
    ).join("");

    CAMPOS.forEach((c) => {
      const check = document.getElementById(`ct-${c.clave}-color-on`);
      const colorInput = document.getElementById(`ct-${c.clave}-color`);
      check.addEventListener("change", () => {
        colorInput.disabled = !check.checked;
      });
    });
  }

  async function loadContenido() {
    const claves = CAMPOS.map((c) => c.clave);
    const { data, error } = await supabaseClient.from("contenido_sitio").select("clave, valor, color, fuente").in("clave", claves);
    if (error) return;

    (data || []).forEach((fila) => {
      const textarea = document.getElementById(`ct-${fila.clave}`);
      const check = document.getElementById(`ct-${fila.clave}-color-on`);
      const colorInput = document.getElementById(`ct-${fila.clave}-color`);
      const fuenteSelect = document.getElementById(`ct-${fila.clave}-fuente`);
      if (!textarea) return;

      textarea.value = fila.valor || "";
      if (fila.color) {
        check.checked = true;
        colorInput.disabled = false;
        colorInput.value = fila.color;
      } else {
        check.checked = false;
        colorInput.disabled = true;
      }
      fuenteSelect.value = fila.fuente || "";
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const filas = CAMPOS.map((c) => {
      const textarea = document.getElementById(`ct-${c.clave}`);
      const check = document.getElementById(`ct-${c.clave}-color-on`);
      const colorInput = document.getElementById(`ct-${c.clave}-color`);
      const fuenteSelect = document.getElementById(`ct-${c.clave}-fuente`);
      return {
        clave: c.clave,
        valor: textarea.value.trim(),
        color: check.checked ? colorInput.value : null,
        fuente: fuenteSelect.value || null,
      };
    });

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
    init() {
      renderCampos();
      loadContenido();
    },
    loadContenido,
  };
})();
