/* =====================================================================
   PATRICIA DAADIN — Panel admin: Ventas
   ---------------------------------------------------------------------
   Portado de src/routes/ventas.js de InmoGestion. Sin la trazabilidad
   fina de Alquileres: el estado se edita libremente entre reserva →
   boleto → escriturada / caída. Alta/edición y cobrar la comisión viven
   en funciones de Postgres (crear_venta, actualizar_venta,
   cobrar_comision_venta — ver supabase/migrations/009_ventas.sql) porque
   sincronizan el estado del inmueble o dejan movimiento en Caja.
   ===================================================================== */

const AdminVentas = (() => {
  const ESTADO_LABEL = { reserva: "Reserva", boleto: "Boleto", escriturada: "Escriturada", caida: "Caída" };

  let cacheVentas = [];
  let cachePropiedades = [];
  let editingId = null;
  let ventaParaCobrar = null;

  const form = document.getElementById("venta-form");
  const formHeading = document.getElementById("venta-form-heading");
  const submitBtn = document.getElementById("venta-submit-btn");
  const cancelarBtn = document.getElementById("venta-cancelar-edicion");
  const errorBox = document.getElementById("venta-form-error");
  const propiedadSelect = document.getElementById("ve-propiedad");
  const compradorSelect = document.getElementById("ve-comprador");
  const compradorNuevaBtn = document.getElementById("ve-comprador-nueva");
  const listBox = document.getElementById("ventas-list");

  const cobrarModal = document.getElementById("cobrar-comision-modal");
  const cobrarForm = document.getElementById("cobrar-comision-form");
  const cobrarResumen = document.getElementById("cc-resumen");
  const cobrarError = document.getElementById("cc-error");

  function opcionesPersonas(seleccionadoId) {
    const personas = AdminPersonas.getAll();
    return (
      `<option value="">Elegir persona...</option>` +
      personas.map((p) => `<option value="${p.id}" ${String(p.id) === String(seleccionadoId) ? "selected" : ""}>${p.nombre}</option>`).join("")
    );
  }

  async function poblarSelects(seleccionarPropiedadId, seleccionarCompradorId) {
    const { data } = await supabaseClient
      .from("propiedades")
      .select("id, codigo, titulo_publico, calle, barrio")
      .eq("activo", true)
      .order("codigo");
    cachePropiedades = data || [];
    const propiedadActual = seleccionarPropiedadId ?? propiedadSelect.value;
    propiedadSelect.innerHTML =
      `<option value="">Elegir inmueble...</option>` +
      cachePropiedades.map((p) => `<option value="${p.id}" ${String(p.id) === String(propiedadActual) ? "selected" : ""}>${p.codigo || ""} — ${p.titulo_publico || p.calle || p.barrio || "sin título"}</option>`).join("");

    await AdminPersonas.loadList();
    const compradorActual = seleccionarCompradorId ?? compradorSelect.value;
    compradorSelect.innerHTML = opcionesPersonas(compradorActual);
  }

  compradorNuevaBtn.addEventListener("click", () => {
    AdminPersonas.abrirModal(null, (nuevoId) => {
      compradorSelect.innerHTML = opcionesPersonas(nuevoId);
    });
  });

  function prepararNuevo() {
    editingId = null;
    form.reset();
    formHeading.textContent = "＋ Nueva operación";
    submitBtn.textContent = "Guardar operación";
    cancelarBtn.style.display = "none";
    errorBox.style.display = "none";
  }
  cancelarBtn.addEventListener("click", prepararNuevo);

  function startEdit(id) {
    const venta = cacheVentas.find((v) => v.id === id);
    if (!venta) return;
    editingId = id;
    errorBox.style.display = "none";
    form.elements.propiedad_id.value = venta.propiedad_id;
    form.elements.comprador_id.value = venta.comprador_id || "";
    form.elements.estado.value = venta.estado;
    form.elements.monto_operacion.value = Dinero.aPesos(venta.monto_operacion);
    form.elements.moneda.value = venta.moneda;
    form.elements.fecha_reserva.value = venta.fecha_reserva || "";
    form.elements.monto_reserva.value = Dinero.aPesos(venta.monto_reserva) || "";
    form.elements.fecha_boleto.value = venta.fecha_boleto || "";
    form.elements.fecha_escritura.value = venta.fecha_escritura || "";
    form.elements.comision_pct.value = venta.comision_pct || "";
    form.elements.comision_monto.value = Dinero.aPesos(venta.comision_monto) || "";
    form.elements.notas.value = venta.notas || "";
    formHeading.textContent = "Editando operación";
    submitBtn.textContent = "Actualizar operación";
    cancelarBtn.style.display = "inline-block";
    window.scrollTo({ top: form.offsetTop - 100, behavior: "smooth" });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.style.display = "none";
    const data = new FormData(form);
    const datos = {
      propiedad_id: parseInt(data.get("propiedad_id"), 10),
      comprador_id: data.get("comprador_id") ? parseInt(data.get("comprador_id"), 10) : null,
      estado: data.get("estado"),
      monto_operacion: Dinero.aCentavos(data.get("monto_operacion")),
      moneda: data.get("moneda"),
      fecha_reserva: data.get("fecha_reserva") || null,
      monto_reserva: data.get("monto_reserva") ? Dinero.aCentavos(data.get("monto_reserva")) : null,
      fecha_boleto: data.get("fecha_boleto") || null,
      fecha_escritura: data.get("fecha_escritura") || null,
      comision_pct: V.decimal(data.get("comision_pct")),
      comision_monto: data.get("comision_monto") ? Dinero.aCentavos(data.get("comision_monto")) : null,
      notas: V.texto(data.get("notas"), { max: 2000 }),
    };
    if (!datos.propiedad_id) return avisar("Elegí el inmueble.", "error");

    submitBtn.disabled = true;
    try {
      if (editingId) {
        const { error } = await supabaseClient.rpc("actualizar_venta", { p_venta_id: editingId, p_datos: datos });
        if (error) throw error;
      } else {
        const { error } = await supabaseClient.rpc("crear_venta", { p_datos: datos });
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

  async function loadList() {
    listBox.innerHTML = `<p style="color:var(--color-text-light);">Cargando…</p>`;
    const { data, error } = await supabaseClient
      .from("ventas")
      .select("*, propiedades(codigo, titulo_publico, calle, barrio), personas(nombre)")
      .order("creado_en", { ascending: false });
    if (error) {
      listBox.innerHTML = `<p style="color:var(--color-danger);">No se pudo cargar: ${error.message}</p>`;
      return;
    }
    cacheVentas = data || [];
    if (!cacheVentas.length) {
      listBox.innerHTML = `<p style="color:var(--color-text-light);">Todavía no hay operaciones cargadas.</p>`;
      return;
    }

    listBox.innerHTML = cacheVentas
      .map((v) => {
        const inmueble = v.propiedades ? (v.propiedades.codigo || "") + " — " + (v.propiedades.titulo_publico || v.propiedades.calle || v.propiedades.barrio || "") : "";
        return `
      <div class="admin-list-row">
        <div class="admin-list-info">
          <span class="admin-list-title">${inmueble}</span>
          <span class="admin-status-badge" style="background:${v.estado === "escriturada" ? "#1a9c4a" : v.estado === "caida" ? "var(--color-text-light)" : "#c98a1c"};">${ESTADO_LABEL[v.estado] || v.estado}</span>
          <span class="admin-list-meta" style="display:block;">${v.personas ? "Comprador: " + v.personas.nombre + " · " : ""}${v.moneda} ${(Dinero.aPesos(v.monto_operacion) || 0).toLocaleString("es-AR")}${v.comision_monto ? " · Comisión " + Dinero.formatear(v.comision_monto, v.moneda) + (v.comision_cobrada ? " (cobrada)" : " (pendiente)") : ""}</span>
        </div>
        <div class="admin-list-actions">
          <button type="button" class="btn btn-sm btn-dark" data-editar-venta="${v.id}">Editar</button>
          ${!v.comision_cobrada && v.comision_monto ? `<button type="button" class="btn btn-sm" data-cobrar-comision="${v.id}">Cobrar comisión</button>` : ""}
        </div>
      </div>`;
      })
      .join("");

    listBox.querySelectorAll("[data-editar-venta]").forEach((btn) => {
      btn.addEventListener("click", () => startEdit(parseInt(btn.dataset.editarVenta, 10)));
    });
    listBox.querySelectorAll("[data-cobrar-comision]").forEach((btn) => {
      btn.addEventListener("click", () => abrirCobrar(parseInt(btn.dataset.cobrarComision, 10)));
    });
  }

  function abrirCobrar(ventaId) {
    const venta = cacheVentas.find((v) => v.id === ventaId);
    if (!venta) return;
    ventaParaCobrar = venta;
    cobrarError.style.display = "none";
    cobrarForm.reset();
    cobrarForm.elements.fecha.value = new Date().toISOString().slice(0, 10);
    cobrarResumen.textContent = `Comisión: ${Dinero.formatear(venta.comision_monto, venta.moneda)}.`;
    cobrarModal.style.display = "flex";
  }
  document.getElementById("cc-cancelar").addEventListener("click", () => { cobrarModal.style.display = "none"; });
  cobrarModal.addEventListener("click", (e) => { if (e.target === cobrarModal) cobrarModal.style.display = "none"; });

  cobrarForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    cobrarError.style.display = "none";
    const data = new FormData(cobrarForm);
    const { error } = await supabaseClient.rpc("cobrar_comision_venta", {
      p_venta_id: ventaParaCobrar.id, p_fecha: data.get("fecha"), p_medio_pago: data.get("medio_pago"),
    });
    if (error) {
      cobrarError.textContent = error.message;
      cobrarError.style.display = "block";
      return;
    }
    cobrarModal.style.display = "none";
    loadList();
  });

  return {
    init() { poblarSelects(); },
    loadList,
  };
})();
