/* =====================================================================
   PATRICIA DAADIN — Panel admin: Gastos
   ---------------------------------------------------------------------
   Portado de src/routes/gastos.js de InmoGestion. Alta simple (una sola
   tabla, sin transacción cruzada) — la única operación con una regla de
   negocio real es anular_gasto (bloqueada si el gasto ya se descontó en
   una liquidación), que por eso vive como función de Postgres.
   ===================================================================== */

const AdminGastos = (() => {
  let cachePropiedades = [];
  let filtroActual = "pendientes";

  const form = document.getElementById("gasto-form");
  const propiedadSelect = document.getElementById("ga-propiedad");
  const listBox = document.getElementById("gastos-list");

  async function poblarPropiedades() {
    const { data } = await supabaseClient
      .from("propiedades")
      .select("id, codigo, titulo_publico, calle, barrio")
      .eq("activo", true)
      .order("codigo");
    cachePropiedades = data || [];
    propiedadSelect.innerHTML =
      `<option value="">Elegir inmueble...</option>` +
      cachePropiedades.map((p) => `<option value="${p.id}">${p.codigo || ""} — ${p.titulo_publico || p.calle || p.barrio || "sin título"}</option>`).join("");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const payload = {
      propiedad_id: parseInt(data.get("propiedad_id"), 10),
      fecha: data.get("fecha"),
      concepto: V.texto(data.get("concepto"), { max: 255 }),
      monto: Dinero.aCentavos(data.get("monto")),
      medio_pago: V.unoDe(data.get("medio_pago"), ["efectivo", "transferencia", "cheque", "deposito", "mercadopago", "tarjeta", "digital", "otro"], "efectivo"),
      comprobante: V.texto(data.get("comprobante"), { max: 100 }),
    };
    if (!payload.propiedad_id) return alert("Elegí el inmueble.");
    if (!payload.concepto) return alert("Contá de qué es el gasto.");
    if (!payload.monto) return alert("Cargá el monto del gasto.");

    const { error } = await supabaseClient.from("gastos").insert(payload);
    if (error) return alert("No se pudo guardar: " + error.message);
    form.reset();
    loadList();
  });

  document.querySelectorAll("[data-gastos-filtro]").forEach((btn) => {
    btn.addEventListener("click", () => {
      filtroActual = btn.dataset.gastosFiltro;
      loadList();
    });
  });

  async function loadList() {
    listBox.innerHTML = `<p style="color:var(--color-text-light);">Cargando…</p>`;
    let query = supabaseClient
      .from("gastos")
      .select("*, propiedades(codigo, titulo_publico, calle, barrio)")
      .eq("anulado", false)
      .order("fecha", { ascending: false });
    if (filtroActual === "pendientes") query = query.eq("liquidado", false);

    const { data, error } = await query;
    if (error) {
      listBox.innerHTML = `<p style="color:var(--color-danger);">No se pudo cargar: ${error.message}</p>`;
      return;
    }
    if (!data || !data.length) {
      listBox.innerHTML = `<p style="color:var(--color-text-light);">No hay gastos ${filtroActual === "pendientes" ? "pendientes" : "cargados"}.</p>`;
      return;
    }

    listBox.innerHTML = data
      .map((g) => {
        const inmueble = g.propiedades ? (g.propiedades.codigo || "") + " — " + (g.propiedades.titulo_publico || g.propiedades.calle || g.propiedades.barrio || "") : "";
        return `
      <div class="admin-list-row">
        <div class="admin-list-info">
          <span class="admin-list-title">${g.concepto} — ${Dinero.formatear(g.monto)}</span>
          <span class="admin-list-meta" style="display:block;">${inmueble} · ${g.fecha} · ${g.liquidado ? '<span class="admin-status-badge" style="background:var(--color-text-light);">Ya liquidado</span>' : "Pendiente de liquidar"}${g.comprobante ? " · " + g.comprobante : ""}</span>
        </div>
        <div class="admin-list-actions">
          <button type="button" class="admin-delete-link" data-anular-gasto="${g.id}">Anular</button>
        </div>
      </div>`;
      })
      .join("");

    listBox.querySelectorAll("[data-anular-gasto]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("¿Anular este gasto?")) return;
        const { error } = await supabaseClient.rpc("anular_gasto", { p_gasto_id: parseInt(btn.dataset.anularGasto, 10) });
        if (error) return alert("No se pudo anular: " + error.message);
        loadList();
      });
    });
  }

  return {
    init() { poblarPropiedades(); },
    loadList,
    getPropiedades: () => cachePropiedades,
  };
})();
