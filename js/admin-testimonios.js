/* =====================================================================
   PATRICIA DAADIN — Panel admin: Comentarios (testimonios)
   ---------------------------------------------------------------------
   Moderación de los comentarios que cualquiera puede dejar desde la
   home (ver js/testimonios.js). Nada se publica solo: hay que aprobar
   cada uno acá. Ver supabase/migrations/014_testimonios.sql.
   ===================================================================== */

const AdminTestimonios = (() => {
  const pendientesBox = document.getElementById("admin-testimonios-pendientes");
  const aprobadosBox = document.getElementById("admin-testimonios-aprobados");
  if (!pendientesBox || !aprobadosBox) return { init() {}, loadList() {}, contarPendientes: async () => 0 };

  function fila(t, acciones) {
    const fecha = new Date(t.creado_en).toLocaleDateString("es-AR");
    return `
      <div class="admin-list-row">
        <div class="admin-list-info">
          <span class="admin-list-title">${V.escaparHtml(t.nombre)}</span>
          <span class="admin-list-meta" style="display:block;">${fecha}</span>
          <p style="margin-top:6px; color:var(--color-text-light);">"${V.escaparHtml(t.comentario)}"</p>
        </div>
        <div class="admin-list-actions">${acciones}</div>
      </div>`;
  }

  async function loadList() {
    pendientesBox.innerHTML = `<p style="color:var(--color-text-light);">Cargando…</p>`;
    aprobadosBox.innerHTML = `<p style="color:var(--color-text-light);">Cargando…</p>`;

    const { data, error } = await supabaseClient.from("testimonios").select("*").order("creado_en", { ascending: false });
    if (error) {
      pendientesBox.innerHTML = `<p style="color:var(--color-danger);">No se pudo cargar: ${error.message}</p>`;
      aprobadosBox.innerHTML = "";
      return;
    }

    const pendientes = (data || []).filter((t) => !t.aprobado);
    const aprobados = (data || []).filter((t) => t.aprobado);

    pendientesBox.innerHTML = pendientes.length
      ? pendientes.map((t) => fila(t, `
          <button type="button" class="btn btn-sm btn-primary" data-aprobar-testimonio="${t.id}">Aprobar y publicar</button>
          <button type="button" class="admin-delete-link" data-rechazar-testimonio="${t.id}">Rechazar</button>
        `)).join("")
      : `<p style="color:var(--color-text-light);">No hay comentarios esperando aprobación.</p>`;

    aprobadosBox.innerHTML = aprobados.length
      ? aprobados.map((t) => fila(t, `<button type="button" class="admin-delete-link" data-quitar-testimonio="${t.id}">Quitar del sitio</button>`)).join("")
      : `<p style="color:var(--color-text-light);">Todavía no publicaste ningún comentario.</p>`;

    pendientesBox.querySelectorAll("[data-aprobar-testimonio]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const { error } = await supabaseClient.from("testimonios").update({ aprobado: true }).eq("id", parseInt(btn.dataset.aprobarTestimonio, 10));
        if (error) return avisar("No se pudo aprobar: " + error.message, "error");
        avisar("Comentario publicado.");
        loadList();
      });
    });

    pendientesBox.querySelectorAll("[data-rechazar-testimonio]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("¿Rechazar y borrar este comentario? No se puede deshacer.")) return;
        const { error } = await supabaseClient.from("testimonios").delete().eq("id", parseInt(btn.dataset.rechazarTestimonio, 10));
        if (error) return avisar("No se pudo rechazar: " + error.message, "error");
        loadList();
      });
    });

    aprobadosBox.querySelectorAll("[data-quitar-testimonio]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("¿Sacar este comentario del sitio? No se puede deshacer.")) return;
        const { error } = await supabaseClient.from("testimonios").delete().eq("id", parseInt(btn.dataset.quitarTestimonio, 10));
        if (error) return avisar("No se pudo quitar: " + error.message, "error");
        loadList();
      });
    });
  }

  return {
    init: loadList,
    loadList,
    async contarPendientes() {
      const { count } = await supabaseClient.from("testimonios").select("id", { count: "exact", head: true }).eq("aprobado", false);
      return count || 0;
    },
  };
})();
