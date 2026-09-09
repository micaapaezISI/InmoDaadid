/* =====================================================================
   PATRICIA DAADIN — Panel admin: Liquidaciones a propietarios
   ---------------------------------------------------------------------
   Portado de reglas-negocio-liquidacion.md / src/liquidacion/*.js de
   InmoGestion. El cálculo (reparto entre copropietarios, comisión,
   gastos pendientes, liquidación garantizada) y el pago/anulación viven
   en funciones de Postgres (ver supabase/migrations/007_liquidaciones.sql)
   — acá solo se arma el formulario, el listado y el modal de pago.
   ===================================================================== */

const AdminLiquidaciones = (() => {
  const MEDIOS = [
    ["efectivo", "Efectivo"], ["transferencia", "Transferencia"], ["cheque", "Cheque"],
    ["deposito", "Depósito"], ["mercadopago", "Mercado Pago"], ["tarjeta", "Tarjeta"],
    ["digital", "Otro digital"], ["otro", "Otro"],
  ];
  const TIPO_LABEL = { cobro: "Cobro", comision: "Comisión", gasto: "Gasto" };
  const ESTADO_LABEL = { pendiente: "Pendiente", pagada: "Pagada", anulada: "Anulada" };

  let cacheLiquidaciones = [];
  let liquidacionParaPagar = null;

  const personaSelect = document.getElementById("lq-persona");
  const periodoInput = document.getElementById("lq-periodo");
  const generarBtn = document.getElementById("lq-generar-btn");
  const generarResultado = document.getElementById("lq-generar-resultado");
  const listBox = document.getElementById("liquidaciones-list");

  const modal = document.getElementById("pagar-liquidacion-modal");
  const resumenEl = document.getElementById("pl-resumen");
  const fechaInput = document.getElementById("pl-fecha");
  const mediosList = document.getElementById("pl-medios-list");
  const medioAgregarBtn = document.getElementById("pl-medio-agregar");
  const confirmarBtn = document.getElementById("pl-confirmar-btn");
  const cancelarBtn = document.getElementById("pl-cancelar-btn");
  const errorEl = document.getElementById("pl-error");

  /* ------------------------------ Generar ------------------------------ */

  async function poblarPersonas() {
    if (!AdminPersonas.getAll().length) await AdminPersonas.loadList();
    const personas = AdminPersonas.getAll();
    personaSelect.innerHTML = `<option value="">Elegir propietario...</option>` + personas.map((p) => `<option value="${p.id}">${p.nombre}</option>`).join("");
  }

  generarBtn.addEventListener("click", async () => {
    generarResultado.style.display = "none";
    const personaId = parseInt(personaSelect.value, 10);
    const periodo = periodoInput.value;
    if (!personaId) return alert("Elegí el propietario.");
    if (!periodo) return alert("Elegí el período.");

    generarBtn.disabled = true;
    generarBtn.textContent = "Generando…";
    try {
      const { data, error } = await supabaseClient.rpc("generar_liquidacion", { p_persona_id: personaId, p_periodo: periodo });
      if (error) throw error;

      generarResultado.style.display = "block";
      if (!data.generada) {
        generarResultado.style.color = "var(--color-text-light)";
        generarResultado.textContent = data.motivo;
      } else {
        generarResultado.style.color = "var(--color-secondary)";
        generarResultado.textContent = `Liquidación generada: neto ${Dinero.formatear(data.total_neto)} (cobrado ${Dinero.formatear(data.total_cobrado)}, comisión ${Dinero.formatear(data.total_comision)}, gastos ${Dinero.formatear(data.total_gastos)}).`;
      }
      loadList();
    } catch (err) {
      generarResultado.style.display = "block";
      generarResultado.style.color = "var(--color-danger)";
      generarResultado.textContent = err.message || String(err);
    } finally {
      generarBtn.disabled = false;
      generarBtn.textContent = "Generar";
    }
  });

  /* ------------------------------ Listado ------------------------------ */

  async function loadList() {
    listBox.innerHTML = `<p style="color:var(--color-text-light);">Cargando…</p>`;
    const { data, error } = await supabaseClient
      .from("liquidaciones")
      .select("*, personas(nombre)")
      .order("creado_en", { ascending: false })
      .limit(200);
    if (error) {
      listBox.innerHTML = `<p style="color:var(--color-danger);">No se pudo cargar: ${error.message}</p>`;
      return;
    }
    if (!data || !data.length) {
      listBox.innerHTML = `<p style="color:var(--color-text-light);">Todavía no hay liquidaciones generadas.</p>`;
      return;
    }
    cacheLiquidaciones = data;

    listBox.innerHTML = data
      .map((l) => `
      <div class="admin-list-row" style="flex-direction:column; align-items:stretch;">
        <div style="display:flex; flex-wrap:wrap; align-items:center; gap:14px;">
          <div class="admin-list-info">
            <span class="admin-list-title">${l.personas ? l.personas.nombre : "-"} — ${l.periodo}</span>
            <span class="admin-status-badge" style="background:${l.estado === "pagada" ? "#1a9c4a" : l.estado === "anulada" ? "var(--color-text-light)" : "#c98a1c"};">${ESTADO_LABEL[l.estado] || l.estado}</span>
            <span class="admin-list-meta" style="display:block;">Neto: ${Dinero.formatear(l.total_neto)} · Cobrado ${Dinero.formatear(l.total_cobrado)} · Comisión ${Dinero.formatear(l.total_comision)} · Gastos ${Dinero.formatear(l.total_gastos)}</span>
          </div>
          <div class="admin-list-actions">
            <button type="button" class="btn btn-sm btn-dark" data-ver-detalle="${l.id}">Ver detalle</button>
            ${l.estado === "pendiente" ? `<button type="button" class="btn btn-sm" data-pagar="${l.id}">Pagar</button>` : ""}
            ${l.estado !== "anulada" ? `<button type="button" class="admin-delete-link" data-anular-liquidacion="${l.id}">Anular</button>` : ""}
          </div>
        </div>
        <div data-detalle-de="${l.id}" style="display:none; margin-top:14px; padding-top:14px; border-top:1px solid var(--color-border);"></div>
      </div>`)
      .join("");

    listBox.querySelectorAll("[data-ver-detalle]").forEach((btn) => {
      btn.addEventListener("click", () => toggleDetalle(parseInt(btn.dataset.verDetalle, 10)));
    });
    listBox.querySelectorAll("[data-pagar]").forEach((btn) => {
      btn.addEventListener("click", () => abrirPagar(parseInt(btn.dataset.pagar, 10)));
    });
    listBox.querySelectorAll("[data-anular-liquidacion]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const motivo = prompt("Motivo de la anulación:");
        if (motivo === null) return;
        if (!motivo.trim()) return alert("Contá el motivo de la anulación.");
        const { error } = await supabaseClient.rpc("anular_liquidacion", { p_liquidacion_id: parseInt(btn.dataset.anularLiquidacion, 10), p_motivo: motivo.trim() });
        if (error) return alert("No se pudo anular: " + error.message);
        loadList();
        AdminGastos.loadList();
      });
    });
  }

  async function toggleDetalle(liquidacionId) {
    const contenedor = listBox.querySelector(`[data-detalle-de="${liquidacionId}"]`);
    if (!contenedor) return;
    if (contenedor.style.display === "block") {
      contenedor.style.display = "none";
      return;
    }
    contenedor.style.display = "block";
    contenedor.innerHTML = "Cargando…";
    const { data, error } = await supabaseClient
      .from("liquidacion_detalle")
      .select("*, propiedades(codigo)")
      .eq("liquidacion_id", liquidacionId)
      .order("id");
    if (error) { contenedor.innerHTML = "No se pudo cargar: " + error.message; return; }
    if (!data.length) { contenedor.innerHTML = "Sin detalle."; return; }
    contenedor.innerHTML = data
      .map((d) => `
        <div style="display:flex; justify-content:space-between; gap:10px; padding:6px 0; border-top:1px solid var(--color-border); font-size:0.9rem;">
          <span>${d.propiedades ? d.propiedades.codigo + " — " : ""}${d.concepto} <span style="color:var(--color-text-light);">(${TIPO_LABEL[d.tipo] || d.tipo})</span></span>
          <strong>${d.tipo === "cobro" ? "" : "-"}${Dinero.formatear(d.monto)}</strong>
        </div>`)
      .join("");
  }

  /* ------------------------------- Pagar ------------------------------- */

  function addMedioRow() {
    const row = document.createElement("div");
    row.className = "admin-list-row";
    row.dataset.medioRow = "1";
    row.style.cssText = "gap:10px; padding:6px 0;";
    row.innerHTML = `
      <select data-medio-tipo style="padding:10px; border:1.5px solid var(--color-border); border-radius:var(--radius-sm); background:var(--color-bg-alt);">
        ${MEDIOS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
      </select>
      <input type="number" data-medio-monto placeholder="Monto" min="0" style="width:140px; padding:10px; border:1.5px solid var(--color-border); border-radius:var(--radius-sm); background:var(--color-bg-alt);">
      <input type="text" data-medio-referencia placeholder="Referencia (opcional)" style="flex:1; min-width:120px; padding:10px; border:1.5px solid var(--color-border); border-radius:var(--radius-sm); background:var(--color-bg-alt);">
      <button type="button" class="admin-delete-link" data-medio-quitar>Quitar</button>
    `;
    row.querySelector("[data-medio-quitar]").addEventListener("click", () => {
      if (mediosList.children.length > 1) row.remove();
    });
    mediosList.appendChild(row);
  }
  medioAgregarBtn.addEventListener("click", addMedioRow);

  function abrirPagar(liquidacionId) {
    const liq = cacheLiquidaciones.find((l) => l.id === liquidacionId);
    if (!liq) return;
    liquidacionParaPagar = liq;
    errorEl.style.display = "none";
    resumenEl.textContent = `${liq.personas ? liq.personas.nombre : ""} — período ${liq.periodo}. Neto a pagar: ${Dinero.formatear(liq.total_neto)}.`;
    fechaInput.value = new Date().toISOString().slice(0, 10);
    mediosList.innerHTML = "";
    addMedioRow();
    mediosList.querySelector("[data-medio-monto]").value = Dinero.aPesos(liq.total_neto);
    modal.style.display = "flex";
  }
  cancelarBtn.addEventListener("click", () => { modal.style.display = "none"; });
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; });

  confirmarBtn.addEventListener("click", async () => {
    errorEl.style.display = "none";
    const medios = Array.from(mediosList.querySelectorAll("[data-medio-row]")).map((row) => ({
      medio_pago: row.querySelector("[data-medio-tipo]").value,
      monto: Dinero.aCentavos(row.querySelector("[data-medio-monto]").value) || 0,
      referencia: V.texto(row.querySelector("[data-medio-referencia]").value),
    }));

    confirmarBtn.disabled = true;
    try {
      const { data, error } = await supabaseClient.rpc("pagar_liquidacion", {
        p_liquidacion_id: liquidacionParaPagar.id,
        p_fecha_pago: fechaInput.value || null,
        p_medios: medios,
      });
      if (error) throw error;
      modal.style.display = "none";
      alert(`Liquidación pagada. Recibo Nº ${data.recibo_numero}.`);
      loadList();
    } catch (err) {
      errorEl.textContent = err.message || String(err);
      errorEl.style.display = "block";
    } finally {
      confirmarBtn.disabled = false;
    }
  });

  return {
    init() { poblarPersonas(); },
    loadList,
  };
})();
