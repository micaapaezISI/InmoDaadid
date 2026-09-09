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

  let cacheLiquidaciones = new Map(); // liquidacion_id -> {liquidacion_id, persona, periodo, estado, total_neto}
  let gruposExpandidos = new Set(); // "propiedadId|periodo"
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
      .from("liquidacion_detalle")
      .select("tipo, monto, propiedad_id, liquidacion_id, propiedades(codigo, calle, numero), liquidaciones(persona_id, periodo, estado, personas(nombre))")
      .order("liquidacion_id");
    if (error) {
      listBox.innerHTML = `<p style="color:var(--color-danger);">No se pudo cargar: ${error.message}</p>`;
      return;
    }
    if (!data || !data.length) {
      listBox.innerHTML = `<p style="color:var(--color-text-light);">Todavía no hay liquidaciones generadas.</p>`;
      return;
    }

    // Cada propietario de un inmueble se liquida en un registro aparte
    // (uno puede cobrar hoy y el otro el mes que viene) — pero listados
    // como filas separadas de la misma propiedad y período parecía un
    // cobro triplicado, igual que pasaba en Caja con los medios de pago.
    // Se agrupa por (inmueble, período) — mismo criterio que InmoGestion
    // (src/routes/liquidaciones.js, agruparPorInmueble): el pago de cada
    // propietario sigue siendo independiente, solo cambia cómo se lista.
    cacheLiquidaciones = new Map();
    const grupos = new Map();
    data.forEach((f) => {
      const liq = f.liquidaciones;
      if (!cacheLiquidaciones.has(f.liquidacion_id)) {
        cacheLiquidaciones.set(f.liquidacion_id, { liquidacion_id: f.liquidacion_id, persona: liq.personas?.nombre, periodo: liq.periodo, estado: liq.estado, cobrado: 0, comision: 0, gastos: 0 });
      }
      const cacheEntry = cacheLiquidaciones.get(f.liquidacion_id);
      if (f.tipo === "cobro") cacheEntry.cobrado += f.monto;
      else if (f.tipo === "comision") cacheEntry.comision += f.monto;
      else if (f.tipo === "gasto") cacheEntry.gastos += f.monto;

      const claveGrupo = f.propiedad_id + "|" + liq.periodo;
      if (!grupos.has(claveGrupo)) {
        grupos.set(claveGrupo, {
          propiedad_id: f.propiedad_id,
          propiedad_codigo: f.propiedades?.codigo,
          propiedad_direccion: [f.propiedades?.calle, f.propiedades?.numero].filter(Boolean).join(" "),
          periodo: liq.periodo,
          propietarios: new Map(),
        });
      }
      const grupo = grupos.get(claveGrupo);
      if (!grupo.propietarios.has(f.liquidacion_id)) {
        grupo.propietarios.set(f.liquidacion_id, {
          liquidacion_id: f.liquidacion_id, persona: liq.personas?.nombre, estado: liq.estado,
          cobrado: 0, comision: 0, gastos: 0,
        });
      }
      const p = grupo.propietarios.get(f.liquidacion_id);
      if (f.tipo === "cobro") p.cobrado += f.monto;
      else if (f.tipo === "comision") p.comision += f.monto;
      else if (f.tipo === "gasto") p.gastos += f.monto;
    });

    const listaGrupos = [...grupos.values()].map((g) => {
      const propietarios = [...g.propietarios.values()].map((p) => ({ ...p, neto: p.cobrado - p.comision - p.gastos }));
      const activos = propietarios.filter((p) => p.estado !== "anulada");
      const estadoGrupo = activos.length === 0 ? "anulada"
        : activos.every((p) => p.estado === "pagada") ? "pagada"
        : activos.every((p) => p.estado === "pendiente") ? "pendiente"
        : "parcial";
      return { ...g, estado: estadoGrupo, total_neto: propietarios.reduce((t, p) => t + p.neto, 0), propietarios };
    }).sort((a, b) => (a.periodo < b.periodo ? 1 : a.periodo > b.periodo ? -1 : (a.propiedad_codigo || "").localeCompare(b.propiedad_codigo || "")));

    if (!listaGrupos.length) {
      listBox.innerHTML = `<p style="color:var(--color-text-light);">Todavía no hay liquidaciones generadas.</p>`;
      return;
    }

    listBox.innerHTML = listaGrupos
      .map((g) => {
        const claveGrupo = g.propiedad_id + "|" + g.periodo;
        return `
      <div class="admin-list-row" style="flex-direction:column; align-items:stretch; cursor:pointer;" data-grupo-row="${claveGrupo}">
        <div style="display:flex; flex-wrap:wrap; align-items:center; gap:14px;">
          <div class="admin-list-info">
            <span class="admin-list-title">${g.propiedad_codigo || ""} — ${g.propiedad_direccion || "sin dirección"} · ${g.periodo}</span>
            <span class="admin-status-badge" style="background:${g.estado === "pagada" ? "#1a9c4a" : g.estado === "anulada" ? "var(--color-text-light)" : g.estado === "parcial" ? "#c98a1c" : "#c98a1c"};">${ESTADO_LABEL[g.estado] || g.estado}</span>
            <span class="admin-list-meta" style="display:block;">${g.propietarios.length} propietario${g.propietarios.length > 1 ? "s" : ""} · Neto total: ${Dinero.formatear(g.total_neto)}</span>
          </div>
        </div>
        <div data-detalle-grupo="${claveGrupo}" style="display:${gruposExpandidos.has(claveGrupo) ? "block" : "none"}; margin-top:14px; padding-top:14px; border-top:1px solid var(--color-border); cursor:default;"></div>
      </div>`;
      })
      .join("");

    listBox.querySelectorAll("[data-grupo-row]").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest("[data-detalle-grupo]")) return;
        const clave = row.dataset.grupoRow;
        if (gruposExpandidos.has(clave)) gruposExpandidos.delete(clave);
        else gruposExpandidos.add(clave);
        const grupo = listaGrupos.find((g) => (g.propiedad_id + "|" + g.periodo) === clave);
        const contenedor = row.querySelector(`[data-detalle-grupo="${clave}"]`);
        if (gruposExpandidos.has(clave)) {
          contenedor.style.display = "block";
          renderPropietariosDeGrupo(contenedor, grupo);
        } else {
          contenedor.style.display = "none";
        }
      });
    });

    gruposExpandidos.forEach((clave) => {
      const grupo = listaGrupos.find((g) => (g.propiedad_id + "|" + g.periodo) === clave);
      const contenedor = listBox.querySelector(`[data-detalle-grupo="${clave}"]`);
      if (grupo && contenedor) renderPropietariosDeGrupo(contenedor, grupo);
    });
  }

  // Cada propietario del grupo (inmueble+período) sigue siendo un registro
  // totalmente aparte — se ve y se paga/anula desde adentro, cada uno con
  // su propio "Ver detalle" (cobro/comisión/gasto) y sus propias acciones.
  function renderPropietariosDeGrupo(contenedor, grupo) {
    contenedor.innerHTML = grupo.propietarios
      .map((p) => `
        <div class="admin-list-row" style="padding:8px 0;">
          <div class="admin-list-info">
            <span class="admin-list-title">${p.persona || "-"}</span>
            <span class="admin-status-badge" style="background:${p.estado === "pagada" ? "#1a9c4a" : p.estado === "anulada" ? "var(--color-text-light)" : "#c98a1c"};">${ESTADO_LABEL[p.estado] || p.estado}</span>
            <span class="admin-list-meta" style="display:block;">Cobrado ${Dinero.formatear(p.cobrado)} · Comisión ${Dinero.formatear(p.comision)} · Gastos ${Dinero.formatear(p.gastos)} · Neto ${Dinero.formatear(p.neto)}</span>
          </div>
          <div class="admin-list-actions">
            <button type="button" class="btn btn-sm btn-dark" data-ver-detalle="${p.liquidacion_id}">Ver detalle</button>
            ${p.estado === "pendiente" ? `<button type="button" class="btn btn-sm" data-pagar="${p.liquidacion_id}">Pagar</button>` : ""}
            ${p.estado !== "anulada" ? `<button type="button" class="admin-delete-link" data-anular-liquidacion="${p.liquidacion_id}">Anular</button>` : ""}
          </div>
          <div data-detalle-de="${p.liquidacion_id}" style="display:none; width:100%; margin-top:10px; padding-top:10px; border-top:1px solid var(--color-border);"></div>
        </div>`)
      .join("");

    contenedor.querySelectorAll("[data-ver-detalle]").forEach((btn) => {
      btn.addEventListener("click", (e) => { e.stopPropagation(); toggleDetalle(parseInt(btn.dataset.verDetalle, 10)); });
    });
    contenedor.querySelectorAll("[data-pagar]").forEach((btn) => {
      btn.addEventListener("click", (e) => { e.stopPropagation(); abrirPagar(parseInt(btn.dataset.pagar, 10)); });
    });
    contenedor.querySelectorAll("[data-anular-liquidacion]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
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
    const liq = cacheLiquidaciones.get(liquidacionId);
    if (!liq) return;
    const totalNeto = liq.cobrado - liq.comision - liq.gastos;
    liquidacionParaPagar = { id: liquidacionId, total_neto: totalNeto };
    errorEl.style.display = "none";
    resumenEl.textContent = `${liq.persona || ""} — período ${liq.periodo}. Neto a pagar: ${Dinero.formatear(totalNeto)}.`;
    fechaInput.value = new Date().toISOString().slice(0, 10);
    mediosList.innerHTML = "";
    addMedioRow();
    mediosList.querySelector("[data-medio-monto]").value = Dinero.aPesos(totalNeto);
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
