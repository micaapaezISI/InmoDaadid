/* =====================================================================
   PATRICIA DAADIN — Testimonios públicos (con moderación)
   ---------------------------------------------------------------------
   Muestra los comentarios ya aprobados desde el panel admin, y deja que
   cualquier visitante mande el suyo (queda pendiente de aprobación —
   nunca se publica solo). Ver supabase/migrations/014_testimonios.sql.
   ===================================================================== */

async function cargarTestimonios() {
  const grid = document.getElementById("testimonios-grid");
  if (!grid) return;

  const { data, error } = await supabaseClient
    .from("testimonios")
    .select("nombre, comentario, creado_en")
    .eq("aprobado", true)
    .order("creado_en", { ascending: false })
    .limit(9);

  if (error) {
    grid.innerHTML = `<p style="color:var(--color-text-light);">No se pudieron cargar los comentarios en este momento.</p>`;
    return;
  }

  if (!data || data.length === 0) {
    grid.innerHTML = `<p style="color:var(--color-text-light);">Todavía no hay comentarios publicados — ¡dejá el primero!</p>`;
    return;
  }

  grid.innerHTML = data
    .map(
      (t) => `
      <blockquote class="testimonio-card">
        <p>"${V.escaparHtml(t.comentario)}"</p>
        <cite>${V.escaparHtml(t.nombre)}</cite>
      </blockquote>`
    )
    .join("");
}

function initTestimonioForm() {
  const form = document.getElementById("testimonio-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nombre = form.elements.nombre.value.trim();
    const comentario = form.elements.comentario.value.trim();
    if (!nombre || !comentario) return avisar("Completá tu nombre y tu comentario.", "error");

    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    const original = submitBtn.textContent;
    submitBtn.textContent = "Enviando…";

    const { error } = await supabaseClient.from("testimonios").insert({ nombre, comentario });

    submitBtn.disabled = false;
    submitBtn.textContent = original;

    if (error) {
      avisar("No se pudo enviar tu comentario: " + error.message, "error");
      return;
    }

    form.reset();
    avisar("¡Gracias! Tu comentario queda pendiente de aprobación y se publica apenas lo reviso.");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  cargarTestimonios();
  initTestimonioForm();
});
