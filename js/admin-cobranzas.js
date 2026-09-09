/* =====================================================================
   PATRICIA DAADIN — Panel admin: Cobranzas
   ---------------------------------------------------------------------
   Portado de reglas-negocio-cobranzas.md / src/routes/cobranzas.js de
   InmoGestion. El cálculo de mora/bonificación y el registro atómico del
   cobro (recibo + pago por cuota + medios de pago + cheque) viven en
   funciones de Postgres (ver supabase/migrations/006_cobranzas.sql) — acá
   solo se arma la grilla de cuotas, el formulario de cobro y el historial.
   ===================================================================== */

const AdminCobranzas = (() => {
  const MEDIOS = [
    ["efectivo", "Efectivo"], ["transferencia", "Transferencia"], ["cheque", "Cheque"],
    ["deposito", "Depósito"], ["mercadopago", "Mercado Pago"], ["tarjeta", "Tarjeta"],
    ["digital", "Otro digital"], ["otro", "Otro"],
  ];

  let cacheCuotas = [];
  let seleccionPersonaId = null;
  let seleccionCuotaIds = new Set();
  let inquilinoExpandido = null;

  const buscarInput = document.getElementById("cb-buscar");
  const cuotasList = document.getElementById("cb-cuotas-list");

  const cobroPanel = document.getElementById("cb-cobro-panel");
  const cobroResumen = document.getElementById("cb-cobro-resumen");
  const fechaPagoInput = document.getElementById("cb-fecha-pago");
  const observacionesInput = document.getElementById("cb-observaciones");
  const mediosList = document.getElementById("cb-medios-list");
  const medioAgregarBtn = document.getElementById("cb-medio-agregar");
  const totalACobrarEl = document.getElementById("cb-total-a-cobrar");
  const registrarBtn = document.getElementById("cb-registrar-btn");
  const cancelarCobroBtn = document.getElementById("cb-cancelar-cobro");
  const cobroErrorEl = document.getElementById("cb-cobro-error");
  const reciboResultadoEl = document.getElementById("cb-recibo-resultado");

  const historialList = document.getElementById("cb-historial-list");

  const bonifModal = document.getElementById("bonificacion-modal");
  const bonifForm = document.getElementById("bonificacion-form");
  const bonifErrorEl = document.getElementById("bonificacion-form-error");
  let bonifCuotaId = null;

  /* --------------------------- Cuotas pendientes ------------------------- */

  async function loadCuotas() {
    cuotasList.innerHTML = `<p style="color:var(--color-text-light);">Cargando…</p>`;
    const q = buscarInput.value.trim();
    const { data, error } = await supabaseClient.rpc("cuotas_pendientes_cobro", { p_q: q || null });
    if (error) {
      cuotasList.innerHTML = `<p style="color:var(--color-danger);">No se pudo cargar: ${error.message}</p>`;
      return;
    }
    cacheCuotas = data || [];
    // Una cuota que ya no está en la lista (se cobró, o cambió de otra forma) no puede seguir seleccionada.
    seleccionCuotaIds = new Set([...seleccionCuotaIds].filter((id) => cacheCuotas.some((c) => c.id === id)));
    if (inquilinoExpandido !== null && !cacheCuotas.some((c) => c.inquilino_id === inquilinoExpandido)) {
      inquilinoExpandido = null;
    }
    renderCuotas();
    if (!seleccionCuotaIds.size) cobroPanel.style.display = "none";
  }

  // Una fila por inquilino (cantidad de cuotas + total), atrasados primero
  // — mismo criterio que InmoGestion (public/js/cobranzas.js): evita la
  // grilla plana de todas las cuotas de todos los inquilinos mezcladas.
  // Recién al hacer click se despliega el detalle de sus cuotas.
  function agruparPorInquilino() {
    const porInquilino = new Map();
    cacheCuotas.forEach((c) => {
      if (!porInquilino.has(c.inquilino_id)) {
        porInquilino.set(c.inquilino_id, { inquilino_id: c.inquilino_id, nombre: c.inquilino_nombre, cuotas: [] });
      }
      porInquilino.get(c.inquilino_id).cuotas.push(c);
    });
    const lista = [...porInquilino.values()].map((g) => ({
      ...g,
      atrasadas: g.cuotas.filter((c) => c.dias_atraso > 0).length,
      total: g.cuotas.reduce((t, c) => t + c.total_a_cobrar, 0),
      moneda: g.cuotas[0].moneda,
    }));
    return lista.sort((a, b) => (b.atrasadas > 0 ? 1 : 0) - (a.atrasadas > 0 ? 1 : 0));
  }

  function renderCuotas() {
    if (!cacheCuotas.length) {
      cuotasList.innerHTML = `<p style="color:var(--color-text-light); padding-top:14px;">No hay cuotas pendientes de cobro.</p>`;
      return;
    }
    const grupos = agruparPorInquilino();
    cuotasList.innerHTML = grupos
      .map((g) => `
      <div class="admin-list-row" style="flex-direction:column; align-items:stretch; cursor:pointer;" data-inquilino-row="${g.inquilino_id}">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:14px; flex-wrap:wrap;">
          <div class="admin-list-info">
            <span class="admin-list-title">${g.nombre}</span>
            ${g.atrasadas > 0 ? `<span class="admin-status-badge" style="background:var(--color-danger);">${g.atrasadas} atrasada${g.atrasadas > 1 ? "s" : ""}</span>` : ""}
            <span class="admin-list-meta" style="display:block;">${g.cuotas.length} cuota${g.cuotas.length > 1 ? "s" : ""} pendiente${g.cuotas.length > 1 ? "s" : ""}</span>
          </div>
          <strong>${Dinero.formatear(g.total, g.moneda)}</strong>
        </div>
        <div data-detalle-inquilino="${g.inquilino_id}" style="display:${inquilinoExpandido === g.inquilino_id ? "block" : "none"}; margin-top:14px; padding-top:14px; border-top:1px solid var(--color-border); cursor:default;"></div>
      </div>`)
      .join("");

    cuotasList.querySelectorAll("[data-inquilino-row]").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest("[data-detalle-inquilino]")) return;
        const id = parseInt(row.dataset.inquilinoRow, 10);
        if (inquilinoExpandido === id) {
          inquilinoExpandido = null;
        } else {
          inquilinoExpandido = id;
          seleccionCuotaIds.clear();
          seleccionPersonaId = null;
        }
        cobroPanel.style.display = "none";
        renderCuotas();
      });
    });

    if (inquilinoExpandido !== null) renderDetalleInquilino(inquilinoExpandido);
  }

  // Detalle de las cuotas de un inquilino, separadas en "Vencidas" y "Al
  // día" (mismo criterio que InmoGestion: el color de fondo solo no
  // alcanza como única señal de atraso).
  function renderDetalleInquilino(inquilinoId) {
    const contenedor = cuotasList.querySelector(`[data-detalle-inquilino="${inquilinoId}"]`);
    if (!contenedor) return;
    const cuotas = cacheCuotas.filter((c) => c.inquilino_id === inquilinoId);
    const vencidas = [...cuotas.filter((c) => c.dias_atraso > 0)].sort((a, b) => b.dias_atraso - a.dias_atraso);
    const alDia = cuotas.filter((c) => c.dias_atraso <= 0);

    const filaCuota = (c) => `
      <div class="admin-list-row" style="padding:8px 0;">
        <label style="display:flex; align-items:center; gap:12px; flex:1; cursor:pointer;">
          <input type="checkbox" data-cuota-check="${c.id}" ${seleccionCuotaIds.has(c.id) ? "checked" : ""} style="width:18px; height:18px;">
          <div class="admin-list-info">
            <span class="admin-list-title">${c.propiedad_codigo || ""} ${c.direccion || ""} — período ${c.periodo}</span>
            <span class="admin-list-meta" style="display:block;">
              vence ${Fecha.formatear(c.fecha_vencimiento)}${c.dias_atraso > 0 ? ` · <strong style="color:var(--color-danger);">${c.dias_atraso} día(s) de atraso</strong>` : ""}
              ${c.bonificacion_aplicada > 0 ? ` · Bonificación: ${Dinero.formatear(c.bonificacion_aplicada, c.moneda)}${c.motivo_bonificacion_aplicada ? " (" + c.motivo_bonificacion_aplicada + ")" : ""}` : ""}
              ${c.punitorio_hoy > 0 ? ` · Punitorio hoy: ${Dinero.formatear(c.punitorio_hoy, c.moneda)}` : ""}
            </span>
          </div>
        </label>
        <div class="admin-list-actions">
          <strong>${Dinero.formatear(c.total_a_cobrar, c.moneda)}</strong>
          <button type="button" class="btn btn-sm btn-dark" data-bonificar="${c.id}" title="Descuento puntual sobre esta cuota — se cobra el 100% ya bonificado, no es un pago parcial.">Bonificar</button>
        </div>
      </div>`;

    const bloque = (titulo, lista) => !lista.length ? "" : `
      <div style="font-weight:700; font-size:0.85rem; color:var(--color-text-light); margin:10px 0 4px;">${titulo} (${lista.length})</div>
      ${lista.map(filaCuota).join("")}
    `;

    contenedor.innerHTML = bloque("Vencidas", vencidas) + bloque("Al día", alDia) +
      `<div data-barra-seleccion style="display:flex; align-items:center; justify-content:space-between; gap:14px; margin-top:14px; padding-top:14px; border-top:1px solid var(--color-border); flex-wrap:wrap;"></div>`;

    contenedor.querySelectorAll("[data-cuota-check]").forEach((chk) => {
      chk.addEventListener("change", () => {
        const id = parseInt(chk.dataset.cuotaCheck, 10);
        const cuota = cacheCuotas.find((c) => c.id === id);
        if (chk.checked) {
          seleccionCuotaIds.add(id);
          if (seleccionPersonaId === null) seleccionPersonaId = cuota.inquilino_id;
        } else {
          seleccionCuotaIds.delete(id);
          if (seleccionCuotaIds.size === 0) seleccionPersonaId = null;
        }
        actualizarBarraSeleccion();
      });
    });

    contenedor.querySelectorAll("[data-bonificar]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        abrirBonificacion(parseInt(btn.dataset.bonificar, 10));
      });
    });

    actualizarBarraSeleccion();
  }

  // Tildar cuotas solo actualiza el resumen; recién al tocar "Registrar
  // cobro" se abre la ficha con los medios de pago — no aparece sola con
  // la primera cuota tildada.
  function actualizarBarraSeleccion() {
    const barra = cuotasList.querySelector("[data-barra-seleccion]");
    if (!barra) return;
    const seleccionadas = cacheCuotas.filter((c) => seleccionCuotaIds.has(c.id));
    if (!seleccionadas.length) {
      barra.innerHTML = `<span style="color:var(--color-text-light); font-size:0.9rem;">Elegí las cuotas que querés cobrar.</span>`;
      cobroPanel.style.display = "none";
      return;
    }
    const total = seleccionadas.reduce((t, c) => t + c.total_a_cobrar, 0);
    barra.innerHTML = `
      <span style="font-weight:600;">${seleccionadas.length} cuota${seleccionadas.length > 1 ? "s" : ""} seleccionada${seleccionadas.length > 1 ? "s" : ""} — total ${Dinero.formatear(total, seleccionadas[0].moneda)}</span>
      <button type="button" class="btn btn-primary btn-sm" data-abrir-registrar>Registrar cobro</button>
    `;
    barra.querySelector("[data-abrir-registrar]").addEventListener("click", (e) => {
      e.stopPropagation();
      abrirPanelCobro();
    });
  }

  buscarInput.addEventListener("input", () => loadCuotas());

  /* ------------------------------ Bonificación ---------------------------- */

  function abrirBonificacion(cuotaId) {
    const cuota = cacheCuotas.find((c) => c.id === cuotaId);
    if (!cuota) return;
    bonifCuotaId = cuotaId;
    bonifForm.reset();
    bonifErrorEl.style.display = "none";
    if (cuota.bonificacion > 0) {
      bonifForm.elements.monto.value = Dinero.aPesos(cuota.bonificacion);
      bonifForm.elements.motivo.value = cuota.motivo_bonificacion || "";
    }
    bonifModal.style.display = "flex";
  }
  document.getElementById("bonificacion-cancelar").addEventListener("click", () => { bonifModal.style.display = "none"; });
  bonifModal.addEventListener("click", (e) => { if (e.target === bonifModal) bonifModal.style.display = "none"; });

  bonifForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    bonifErrorEl.style.display = "none";
    const data = new FormData(bonifForm);
    const monto = Dinero.aCentavos(data.get("monto")) || 0;
    const motivo = V.texto(data.get("motivo"), { max: 500 });
    const { error } = await supabaseClient.rpc("bonificar_cuota", { p_cuota_id: bonifCuotaId, p_monto: monto, p_motivo: motivo });
    if (error) {
      bonifErrorEl.textContent = error.message;
      bonifErrorEl.style.display = "block";
      return;
    }
    bonifModal.style.display = "none";
    loadCuotas();
  });

  /* --------------------------- Panel de registro de cobro ------------------- */

  // Se abre solo al tocar "Registrar cobro" en la barra de selección —
  // tildar cuotas nunca la muestra sola.
  function abrirPanelCobro() {
    if (seleccionCuotaIds.size === 0) return;
    cobroPanel.style.display = "block";
    const seleccionadas = cacheCuotas.filter((c) => seleccionCuotaIds.has(c.id));
    const total = seleccionadas.reduce((t, c) => t + c.total_a_cobrar, 0);
    const nombre = seleccionadas[0].inquilino_nombre;
    const moneda = seleccionadas[0].moneda;
    cobroResumen.textContent = `${seleccionadas.length} cuota(s) de ${nombre}: ${seleccionadas.map((c) => c.periodo).join(", ")}.`;
    totalACobrarEl.textContent = Dinero.formatear(total, moneda);
    if (!fechaPagoInput.value) fechaPagoInput.value = new Date().toISOString().slice(0, 10);
    if (!mediosList.children.length) addMedioRow();
    cobroPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function addMedioRow() {
    const row = document.createElement("div");
    row.className = "admin-list-row";
    row.dataset.medioRow = "1";
    row.style.cssText = "flex-direction:column; align-items:stretch; gap:8px; padding:12px; border:1.5px solid var(--color-border); border-radius:var(--radius-sm);";
    row.innerHTML = `
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
        <select data-medio-tipo style="padding:10px; border:1.5px solid var(--color-border); border-radius:var(--radius-sm); background:var(--color-bg-alt);">
          ${MEDIOS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
        </select>
        <input type="number" data-medio-monto placeholder="Monto" min="0" style="width:140px; padding:10px; border:1.5px solid var(--color-border); border-radius:var(--radius-sm); background:var(--color-bg-alt);">
        <input type="text" data-medio-referencia placeholder="Referencia (opcional)" style="flex:1; min-width:140px; padding:10px; border:1.5px solid var(--color-border); border-radius:var(--radius-sm); background:var(--color-bg-alt);">
        <button type="button" class="admin-delete-link" data-medio-quitar>Quitar</button>
      </div>
      <div data-medio-comision-wrap style="display:none; gap:10px;">
        <input type="number" data-medio-comision placeholder="Comisión retenida" min="0" style="width:180px; padding:10px; border:1.5px solid var(--color-border); border-radius:var(--radius-sm); background:var(--color-bg-alt);">
      </div>
      <div data-medio-cheque-wrap style="display:none; gap:10px; flex-wrap:wrap;">
        <input type="text" data-cheque-banco placeholder="Banco" style="padding:10px; border:1.5px solid var(--color-border); border-radius:var(--radius-sm); background:var(--color-bg-alt);">
        <input type="text" data-cheque-numero placeholder="Número de cheque *" style="padding:10px; border:1.5px solid var(--color-border); border-radius:var(--radius-sm); background:var(--color-bg-alt);">
        <input type="date" data-cheque-fecha style="padding:10px; border:1.5px solid var(--color-border); border-radius:var(--radius-sm); background:var(--color-bg-alt);">
      </div>
    `;
    const tipoSelect = row.querySelector("[data-medio-tipo]");
    const comisionWrap = row.querySelector("[data-medio-comision-wrap]");
    const chequeWrap = row.querySelector("[data-medio-cheque-wrap]");
    tipoSelect.addEventListener("change", () => {
      comisionWrap.style.display = ["tarjeta", "digital"].includes(tipoSelect.value) ? "flex" : "none";
      chequeWrap.style.display = tipoSelect.value === "cheque" ? "flex" : "none";
    });
    row.querySelector("[data-medio-quitar]").addEventListener("click", () => {
      if (mediosList.children.length > 1) row.remove();
    });
    mediosList.appendChild(row);
  }
  medioAgregarBtn.addEventListener("click", addMedioRow);

  function leerMedios() {
    return Array.from(mediosList.querySelectorAll("[data-medio-row]")).map((row) => {
      const tipo = row.querySelector("[data-medio-tipo]").value;
      const medio = {
        medio_pago: tipo,
        monto: Dinero.aCentavos(row.querySelector("[data-medio-monto]").value) || 0,
        referencia: V.texto(row.querySelector("[data-medio-referencia]").value),
      };
      if (tipo === "tarjeta" || tipo === "digital") {
        medio.comision_monto = Dinero.aCentavos(row.querySelector("[data-medio-comision]").value) || 0;
      }
      if (tipo === "cheque") {
        medio.cheque = {
          banco: V.texto(row.querySelector("[data-cheque-banco]").value),
          numero: V.texto(row.querySelector("[data-cheque-numero]").value),
          fecha_cheque: row.querySelector("[data-cheque-fecha]").value || null,
        };
      }
      return medio;
    });
  }

  cancelarCobroBtn.addEventListener("click", () => {
    cobroPanel.style.display = "none";
    mediosList.innerHTML = "";
    cobroErrorEl.style.display = "none";
  });

  registrarBtn.addEventListener("click", async () => {
    cobroErrorEl.style.display = "none";

    const medios = leerMedios();
    const datos = {
      persona_id: seleccionPersonaId,
      cuota_ids: [...seleccionCuotaIds],
      fecha_pago: fechaPagoInput.value || null,
      observaciones: V.texto(observacionesInput.value, { max: 2000 }),
      medios,
    };

    registrarBtn.disabled = true;
    registrarBtn.textContent = "Registrando…";
    try {
      const seleccionadas = cacheCuotas.filter((c) => seleccionCuotaIds.has(c.id));
      const moneda = seleccionadas[0] ? seleccionadas[0].moneda : "ARS";
      const nombre = seleccionadas[0] ? seleccionadas[0].inquilino_nombre : "";
      const telefono = seleccionadas[0] ? seleccionadas[0].telefono : null;
      const periodos = [...new Set(seleccionadas.map((c) => c.periodo))].join(", ");

      const { data, error } = await supabaseClient.rpc("registrar_cobro", { p_datos: datos });
      if (error) throw error;

      mostrarRecibo(data, { nombre, moneda, telefono, periodos });

      cobroPanel.style.display = "none";
      seleccionCuotaIds.clear();
      seleccionPersonaId = null;
      observacionesInput.value = "";
      mediosList.innerHTML = "";
      await loadCuotas();
      loadHistorial();
    } catch (err) {
      cobroErrorEl.textContent = err.message || String(err);
      cobroErrorEl.style.display = "block";
    } finally {
      registrarBtn.disabled = false;
      registrarBtn.textContent = "Registrar cobro";
    }
  });

  // Queda a la vista hasta que se cierre a mano (o hasta el próximo
  // cobro) — antes desaparecía solo apenas se volvía a dibujar la lista.
  function mostrarRecibo(data, { nombre, moneda, telefono, periodos }) {
    const mensaje = `Hola ${nombre}, te escribimos de la inmobiliaria para confirmarte que recibimos tu pago de ${periodos} por ${Dinero.formatear(data.total, moneda)}. ¡Gracias!`;
    const link = linkWhatsApp(telefono, mensaje);
    reciboResultadoEl.style.display = "block";
    reciboResultadoEl.innerHTML = `
      <div style="border:1.5px solid var(--color-secondary); background:var(--color-bg-alt); border-radius:var(--radius-sm); padding:20px;">
        <h2 style="margin-top:0;">✅ Recibo Nº ${data.recibo_numero}</h2>
        <p>${nombre} — total ${Dinero.formatear(data.total, moneda)}.</p>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button type="button" class="btn btn-dark btn-sm" id="cb-imprimir-btn">Descargar / imprimir recibo</button>
          ${link ? `<a class="btn btn-sm" style="background:#25D366; color:#fff;" href="${link}" target="_blank" rel="noopener">Avisar por WhatsApp</a>` : ""}
          <button type="button" class="btn btn-dark btn-sm" id="cb-cerrar-recibo-btn">Cerrar</button>
        </div>
      </div>`;
    document.getElementById("cb-imprimir-btn").addEventListener("click", () => imprimirRecibo(data.recibo_id));
    document.getElementById("cb-cerrar-recibo-btn").addEventListener("click", () => { reciboResultadoEl.style.display = "none"; });
  }

  /* ------------------------------- Recibo imprimible ------------------------ */

  async function imprimirRecibo(reciboId) {
    const { data: recibo } = await supabaseClient.from("recibos").select("*, personas(nombre, documento_tipo, documento)").eq("id", reciboId).single();
    if (!recibo) return alert("No se pudo cargar el recibo.");

    const { data: pagos } = await supabaseClient.from("pagos").select("*").eq("recibo_id", reciboId).order("id");
    const pagoIds = (pagos || []).map((p) => p.id);
    const { data: imputaciones } = pagoIds.length
      ? await supabaseClient.from("pago_imputacion").select("*, cuotas(periodo)").in("pago_id", pagoIds)
      : { data: [] };
    const { data: medios } = pagoIds.length
      ? await supabaseClient.from("medio_pago_detalle").select("*").in("pago_id", pagoIds)
      : { data: [] };

    const anulado = (pagos || []).length > 0 && pagos.every((p) => p.anulado);
    const CONCEPTO_LABEL = { alquiler: "Alquiler", expensas: "Expensas", punitorio: "Interés punitorio", otros: "Otros" };

    const filasConcepto = (imputaciones || [])
      .map((i) => `<tr><td>${CONCEPTO_LABEL[i.concepto] || i.concepto} — período ${i.cuotas ? i.cuotas.periodo : ""}</td><td style="text-align:right;">${Dinero.formatear(i.monto, (pagos.find(p=>p.id===i.pago_id)||{}).moneda)}</td></tr>`)
      .join("");
    const filasMedios = (medios || [])
      .map((m) => `<tr><td>${m.medio_pago}${m.referencia ? " — " + m.referencia : ""}</td><td style="text-align:right;">${Dinero.formatear(m.monto)}</td></tr>`)
      .join("");

    document.getElementById("recibo-imprimible").innerHTML = `
      <div style="max-width:640px; margin:0 auto; padding:30px; font-family:sans-serif;">
        ${anulado ? '<h1 style="color:#b00; text-align:center;">ANULADO</h1>' : ""}
        <h1>Patricia Daadin — Martillera</h1>
        <h2>Recibo Nº ${recibo.numero}</h2>
        <p>Fecha: ${Fecha.formatear(recibo.fecha_emision)}</p>
        <p>Recibí de: <strong>${recibo.personas.nombre}</strong> ${recibo.personas.documento ? `(${recibo.personas.documento_tipo} ${recibo.personas.documento})` : ""}</p>
        <p>Concepto: ${recibo.concepto || ""}</p>
        <table style="width:100%; border-collapse:collapse; margin-top:16px;">${filasConcepto}</table>
        <h3 style="text-align:right; margin-top:14px;">Total: ${Dinero.formatear(recibo.total)}</h3>
        <h4 style="margin-top:20px;">Medios de pago</h4>
        <table style="width:100%; border-collapse:collapse;">${filasMedios}</table>
      </div>`;

    document.body.classList.add("printing-recibo");
    window.print();
    setTimeout(() => document.body.classList.remove("printing-recibo"), 500);
  }

  /* ------------------------------ Historial de cobros ------------------------ */

  async function loadHistorial() {
    historialList.innerHTML = `<p style="color:var(--color-text-light);">Cargando…</p>`;
    const { data, error } = await supabaseClient
      .from("pagos")
      .select("*, personas(nombre), recibos(numero), pago_cheque(*)")
      .order("fecha_pago", { ascending: false })
      .order("id", { ascending: false })
      .limit(200);
    if (error) {
      historialList.innerHTML = `<p style="color:var(--color-danger);">No se pudo cargar: ${error.message}</p>`;
      return;
    }
    if (!data || !data.length) {
      historialList.innerHTML = `<p style="color:var(--color-text-light);">Todavía no hay cobros registrados.</p>`;
      return;
    }

    const ESTADO_CHEQUE_SIGUIENTE = { en_cartera: ["depositado", "rechazado"], depositado: ["acreditado", "rechazado"] };

    historialList.innerHTML = data
      .map((p) => {
        const cheque = p.pago_cheque;
        return `
      <div class="admin-list-row">
        <div class="admin-list-info">
          <span class="admin-list-title">${p.personas ? p.personas.nombre : "-"} — ${Dinero.formatear(p.monto, p.moneda)} ${p.anulado ? '<span class="admin-status-badge" style="background:var(--color-danger);">ANULADO</span>' : ""}</span>
          <span class="admin-list-meta" style="display:block;">Recibo Nº ${p.recibos ? p.recibos.numero : "-"} · ${Fecha.formatear(p.fecha_pago)} · ${p.medio_pago}${cheque ? ` (cheque: ${cheque.estado})` : ""}</span>
        </div>
        <div class="admin-list-actions">
          ${cheque && !p.anulado && ESTADO_CHEQUE_SIGUIENTE[cheque.estado] ? ESTADO_CHEQUE_SIGUIENTE[cheque.estado].map((e) =>
            `<button type="button" class="btn btn-sm btn-dark" data-cheque-estado="${p.id}" data-estado-nuevo="${e}">→ ${e}</button>`
          ).join("") : ""}
          ${!p.anulado ? `<button type="button" class="admin-delete-link" data-anular-cobro="${p.id}">Anular</button>` : ""}
        </div>
      </div>`;
      })
      .join("");

    historialList.querySelectorAll("[data-anular-cobro]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const motivo = prompt("Motivo de la anulación:");
        if (motivo === null) return;
        if (!motivo.trim()) return alert("Contá el motivo de la anulación.");
        const { error } = await supabaseClient.rpc("anular_cobro", { p_pago_id: parseInt(btn.dataset.anularCobro, 10), p_motivo: motivo.trim() });
        if (error) return alert("No se pudo anular: " + error.message);
        loadHistorial();
        loadCuotas();
      });
    });

    historialList.querySelectorAll("[data-cheque-estado]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const estadoNuevo = btn.dataset.estadoNuevo;
        let motivo = null;
        if (estadoNuevo === "rechazado") {
          motivo = prompt("Motivo del rechazo:");
          if (motivo === null) return;
          if (!motivo.trim()) return alert("Contá el motivo del rechazo.");
        }
        const { error } = await supabaseClient.rpc("actualizar_estado_cheque", {
          p_pago_id: parseInt(btn.dataset.chequeEstado, 10), p_estado: estadoNuevo, p_motivo_rechazo: motivo,
        });
        if (error) return alert("No se pudo actualizar: " + error.message);
        loadHistorial();
      });
    });
  }

  return {
    init() {},
    loadCuotas,
    loadHistorial,
  };
})();
