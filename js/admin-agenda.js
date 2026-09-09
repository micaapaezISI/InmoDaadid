/* =====================================================================
   PATRICIA DAADIN — Panel admin: Agenda
   ---------------------------------------------------------------------
   Portado de src/routes/eventos.js de InmoGestion. Alta/edición/completar/
   cancelar son operaciones de una sola tabla — van directo por
   supabase-js, protegidas por RLS. Los eventos de "vencimiento" (fin de
   contrato, vencimiento de cuota) los generan solos los triggers de
   Postgres al crear un contrato o una cuota (ver supabase/migrations/
   010_agenda.sql) — acá no se cargan a mano, solo se consultan.
   ===================================================================== */

const AdminAgenda = (() => {
  const TIPO_LABEL = { visita: "Visita", llamado: "Llamado", vencimiento: "Vencimiento", tasacion: "Tasación", firma: "Firma", recordatorio: "Recordatorio", otro: "Otro" };
  const ESTADO_LABEL = { pendiente: "Pendiente", realizado: "Realizado", cancelado: "Cancelado" };

  let cacheEventos = [];
  let editingId = null;

  const form = document.getElementById("evento-form");
  const formHeading = document.getElementById("evento-form-heading");
  const submitBtn = document.getElementById("evento-submit-btn");
  const cancelarEdicionBtn = document.getElementById("evento-cancelar-edicion");
  const errorBox = document.getElementById("evento-form-error");
  const propiedadSelect = document.getElementById("ev-propiedad");
  const personaSelect = document.getElementById("ev-persona");
  const desdeInput = document.getElementById("ag-desde");
  const hastaInput = document.getElementById("ag-hasta");
  const filtrarBtn = document.getElementById("ag-filtrar-btn");
  const listBox = document.getElementById("eventos-list");

  function primerDiaMes() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  }
  function ultimoDiaMes() {
    const d = new Date();
    const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}`;
  }

  async function poblarSelects() {
    const { data: propiedades } = await supabaseClient.from("propiedades").select("id, codigo, titulo_publico, calle, barrio").eq("activo", true).order("codigo");
    propiedadSelect.innerHTML = `<option value="">Sin inmueble</option>` + (propiedades || []).map((p) => `<option value="${p.id}">${p.codigo || ""} — ${p.titulo_publico || p.calle || p.barrio || "sin título"}</option>`).join("");

    if (!AdminPersonas.getAll().length) await AdminPersonas.loadList();
    personaSelect.innerHTML = `<option value="">Sin persona</option>` + AdminPersonas.getAll().map((p) => `<option value="${p.id}">${p.nombre}</option>`).join("");
  }

  function prepararNuevo() {
    editingId = null;
    form.reset();
    formHeading.textContent = "＋ Nuevo evento";
    submitBtn.textContent = "Guardar evento";
    cancelarEdicionBtn.style.display = "none";
    errorBox.style.display = "none";
  }
  cancelarEdicionBtn.addEventListener("click", prepararNuevo);

  function startEdit(id) {
    const ev = cacheEventos.find((e) => e.id === id);
    if (!ev) return;
    editingId = id;
    errorBox.style.display = "none";
    form.elements.tipo.value = ev.tipo;
    form.elements.titulo.value = ev.titulo;
    form.elements.fecha.value = ev.fecha;
    form.elements.hora.value = ev.hora || "";
    form.elements.propiedad_id.value = ev.propiedad_id || "";
    form.elements.persona_id.value = ev.persona_id || "";
    form.elements.descripcion.value = ev.descripcion || "";
    formHeading.textContent = "Editando evento";
    submitBtn.textContent = "Actualizar evento";
    cancelarEdicionBtn.style.display = "inline-block";
    window.scrollTo({ top: form.offsetTop - 100, behavior: "smooth" });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.style.display = "none";
    const data = new FormData(form);
    const payload = {
      tipo: data.get("tipo"),
      titulo: V.texto(data.get("titulo"), { max: 255 }),
      descripcion: V.texto(data.get("descripcion"), { max: 2000 }),
      fecha: data.get("fecha"),
      hora: data.get("hora") || null,
      propiedad_id: data.get("propiedad_id") ? parseInt(data.get("propiedad_id"), 10) : null,
      persona_id: data.get("persona_id") ? parseInt(data.get("persona_id"), 10) : null,
    };
    if (!payload.titulo) return alert("Escribí un título para el evento.");
    if (!payload.fecha) return alert("Cargá la fecha.");

    submitBtn.disabled = true;
    try {
      if (editingId) {
        const { error } = await supabaseClient.from("eventos").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabaseClient.from("eventos").insert(payload);
        if (error) throw error;
      }
      prepararNuevo();
      loadList();
    } catch (err) {
      errorBox.textContent = err.message || String(err);
      errorBox.style.display = "block";
    } finally {
      submitBtn.disabled = false;
    }
  });

  filtrarBtn.addEventListener("click", loadList);

  async function loadList() {
    const desde = desdeInput.value || primerDiaMes();
    const hasta = hastaInput.value || ultimoDiaMes();
    listBox.innerHTML = `<p style="color:var(--color-text-light);">Cargando…</p>`;

    const { data, error } = await supabaseClient
      .from("eventos")
      .select("*, propiedades(codigo), personas(nombre)")
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha")
      .order("hora")
      .limit(500);
    if (error) {
      listBox.innerHTML = `<p style="color:var(--color-danger);">No se pudo cargar: ${error.message}</p>`;
      return;
    }
    cacheEventos = data || [];
    if (!cacheEventos.length) {
      listBox.innerHTML = `<p style="color:var(--color-text-light);">No hay eventos en ese rango.</p>`;
      return;
    }

    listBox.innerHTML = cacheEventos
      .map((ev) => {
        const quien = [ev.propiedades ? ev.propiedades.codigo : null, ev.personas ? ev.personas.nombre : null].filter(Boolean).join(" · ");
        const colorEstado = ev.estado === "realizado" ? "#1a9c4a" : ev.estado === "cancelado" ? "var(--color-text-light)" : "#c98a1c";
        return `
      <div class="admin-list-row">
        <div class="admin-list-info">
          <span class="admin-list-title">${ev.titulo}</span>
          <span class="admin-status-badge" style="background:${colorEstado};">${ESTADO_LABEL[ev.estado] || ev.estado}</span>
          <span class="admin-list-meta" style="display:block;">${TIPO_LABEL[ev.tipo] || ev.tipo} · ${ev.fecha}${ev.hora ? " " + ev.hora : ""}${quien ? " · " + quien : ""}${ev.resultado ? " · " + ev.resultado : ""}</span>
        </div>
        <div class="admin-list-actions">
          ${ev.tipo !== "vencimiento" ? `<button type="button" class="btn btn-sm btn-dark" data-editar-evento="${ev.id}">Editar</button>` : ""}
          ${ev.estado === "pendiente" ? `<button type="button" class="btn btn-sm" data-completar-evento="${ev.id}">Completar</button>` : ""}
          ${ev.estado === "pendiente" ? `<button type="button" class="admin-delete-link" data-cancelar-evento="${ev.id}">Cancelar</button>` : ""}
        </div>
      </div>`;
      })
      .join("");

    listBox.querySelectorAll("[data-editar-evento]").forEach((btn) => {
      btn.addEventListener("click", () => startEdit(parseInt(btn.dataset.editarEvento, 10)));
    });
    listBox.querySelectorAll("[data-completar-evento]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const resultado = prompt("¿Cómo resultó? (opcional)");
        if (resultado === null) return;
        const { error } = await supabaseClient.from("eventos").update({ estado: "realizado", resultado: resultado.trim() || null }).eq("id", parseInt(btn.dataset.completarEvento, 10));
        if (error) return alert("No se pudo completar: " + error.message);
        loadList();
      });
    });
    listBox.querySelectorAll("[data-cancelar-evento]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const resultado = prompt("¿Por qué se cancela? (opcional)");
        if (resultado === null) return;
        const { error } = await supabaseClient.from("eventos").update({ estado: "cancelado", resultado: resultado.trim() || null }).eq("id", parseInt(btn.dataset.cancelarEvento, 10));
        if (error) return alert("No se pudo cancelar: " + error.message);
        loadList();
      });
    });
  }

  return {
    init() {
      desdeInput.value = primerDiaMes();
      hastaInput.value = ultimoDiaMes();
      poblarSelects();
    },
    loadList,
  };
})();
