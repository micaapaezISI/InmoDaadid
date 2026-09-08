/* =====================================================================
   PATRICIA DAADIN — Panel admin: Contratos y alquileres
   ---------------------------------------------------------------------
   Portado de reglas-negocio-alquileres.md de InmoGestion. La generación
   de cuotas (con ajuste por porcentaje o por índice BCRA) y las
   transacciones de alta/rescisión/renovación viven en funciones de
   Postgres (ver supabase/migrations/003_contratos.sql) — acá solo se
   arma el formulario y se muestran los resultados.
   ===================================================================== */

const AdminContratos = (() => {
  let onSaved = () => {};
  let cachePropiedades = [];
  let cacheContratos = [];
  let contratoParaAccion = null;

  const form = document.getElementById("contrato-form");
  const resultBox = document.getElementById("contrato-result");
  const listBox = document.getElementById("admin-contratos-list");
  const submitBtn = document.getElementById("contrato-submit-btn");
  const propiedadSelect = document.getElementById("ct-propiedad");
  const inquilinoSelect = document.getElementById("ct-inquilino");
  const ajusteTipoSelect = document.getElementById("ct-ajuste-tipo");
  const ajusteValorWrap = document.getElementById("ct-ajuste-valor-wrap");
  const indiceWrap = document.getElementById("ct-indice-wrap");
  const indiceBaseWrap = document.getElementById("ct-indice-base-wrap");
  const garantesList = document.getElementById("ct-garantes-list");
  const garanteAgregarBtn = document.getElementById("ct-garante-agregar");

  const indiceForm = document.getElementById("indice-form");
  const indicesListBox = document.getElementById("admin-indices-list");

  const rescindirModal = document.getElementById("rescindir-modal");
  const rescindirForm = document.getElementById("rescindir-form");
  const renovarModal = document.getElementById("renovar-modal");
  const renovarForm = document.getElementById("renovar-form");

  /* ------------------------------ Helpers ------------------------------ */

  function actualizarCamposAjuste() {
    const tipo = ajusteTipoSelect.value;
    ajusteValorWrap.style.display = tipo === "porcentaje" ? "flex" : "none";
    indiceWrap.style.display = tipo === "indice" ? "flex" : "none";
    indiceBaseWrap.style.display = tipo === "indice" ? "flex" : "none";
  }
  ajusteTipoSelect.addEventListener("change", actualizarCamposAjuste);

  function addGaranteRow(personaId, tipoGarantia) {
    const personas = AdminPersonas.getAll();
    const row = document.createElement("div");
    row.className = "admin-list-row";
    row.dataset.garanteRow = "1";
    row.style.cssText = "padding:8px 0; gap:10px;";
    row.innerHTML = `
      <select data-garante-persona style="flex:2; min-width:140px; padding:10px; border:1.5px solid var(--color-border); border-radius:var(--radius-sm); background:var(--color-bg-alt);">
        <option value="">Elegir persona...</option>
        ${personas.map((p) => `<option value="${p.id}">${p.nombre}</option>`).join("")}
      </select>
      <select data-garante-tipo style="padding:10px; border:1.5px solid var(--color-border); border-radius:var(--radius-sm); background:var(--color-bg-alt);">
        <option value="personal">Garante personal</option>
        <option value="propietaria">Garantía propietaria</option>
        <option value="seguro_caucion">Seguro de caución</option>
        <option value="recibo_sueldo">Recibo de sueldo</option>
      </select>
      <button type="button" class="admin-delete-link" data-garante-quitar>Quitar</button>
    `;
    row.querySelector("[data-garante-quitar]").addEventListener("click", () => row.remove());
    garantesList.appendChild(row);
    if (personaId) row.querySelector("[data-garante-persona]").value = personaId;
    if (tipoGarantia) row.querySelector("[data-garante-tipo]").value = tipoGarantia;
  }
  garanteAgregarBtn.addEventListener("click", () => addGaranteRow());

  function leerGarantes() {
    return Array.from(garantesList.querySelectorAll("[data-garante-row]"))
      .map((row) => ({
        persona_id: parseInt(row.querySelector("[data-garante-persona]").value, 10),
        tipo_garantia: row.querySelector("[data-garante-tipo]").value,
      }))
      .filter((g) => g.persona_id);
  }

  async function poblarSelectsBase() {
    const { data: propiedades } = await supabaseClient
      .from("propiedades")
      .select("id, codigo, titulo_publico, calle, barrio")
      .eq("activo", true)
      .in("estado", ["disponible", "alquilada"])
      .order("codigo");
    cachePropiedades = propiedades || [];
    propiedadSelect.innerHTML =
      `<option value="">Elegir inmueble...</option>` +
      cachePropiedades.map((p) => `<option value="${p.id}">${p.codigo || ""} — ${p.titulo_publico || p.calle || p.barrio || "sin título"}</option>`).join("");

    if (!AdminPersonas.getAll().length) await AdminPersonas.loadList();
    const personas = AdminPersonas.getAll();
    inquilinoSelect.innerHTML =
      `<option value="">Elegir persona...</option>` +
      personas.map((p) => `<option value="${p.id}">${p.nombre}</option>`).join("");
  }

  /* --------------------------- Alta de contrato ------------------------ */

  async function prepararNuevo() {
    form.reset();
    garantesList.innerHTML = "";
    resultBox.style.display = "none";
    await poblarSelectsBase();
    actualizarCamposAjuste();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);

    const datos = {
      propiedad_id: parseInt(data.get("propiedad_id"), 10),
      inquilino_id: parseInt(data.get("inquilino_id"), 10),
      tipo_contrato: data.get("tipo_contrato"),
      fecha_inicio: data.get("fecha_inicio"),
      fecha_fin: data.get("fecha_fin"),
      dia_vencimiento: V.entero(data.get("dia_vencimiento")) || 10,
      moneda: data.get("moneda"),
      monto_inicial: Dinero.aCentavos(data.get("monto_inicial")),
      deposito: Dinero.aCentavos(data.get("deposito")) || 0,
      comision_admin_pct: V.decimal(data.get("comision_admin_pct")),
      liquidacion_garantizada: data.get("liquidacion_garantizada") === "on",
      ajuste_tipo: data.get("ajuste_tipo"),
      ajuste_meses: V.entero(data.get("ajuste_meses")),
      ajuste_valor: data.get("ajuste_tipo") === "porcentaje" ? V.decimal(data.get("ajuste_valor")) : null,
      indice_codigo: data.get("ajuste_tipo") === "indice" ? data.get("indice_codigo") : null,
      indice_valor_base: data.get("ajuste_tipo") === "indice" ? V.decimal(data.get("indice_valor_base")) : null,
      fecha_inicio_generacion: data.get("fecha_inicio_generacion") || null,
      monto_actual: data.get("monto_actual") ? Dinero.aCentavos(data.get("monto_actual")) : null,
      notas: V.texto(data.get("notas"), { max: 4000 }),
    };

    if (!datos.propiedad_id || !datos.inquilino_id) return alert("Elegí el inmueble y el inquilino.");

    submitBtn.disabled = true;
    submitBtn.textContent = "Guardando…";
    try {
      const { error } = await supabaseClient.rpc("crear_contrato", { p_datos: datos, p_garantes: leerGarantes() });
      if (error) throw error;

      resultBox.style.display = "block";
      resultBox.innerHTML = `<div class="admin-card" style="border-color:var(--color-secondary); background:var(--color-bg-alt);"><h2>✅ Contrato guardado</h2><p>Las cuotas ya se generaron. Podés verlas desde "Contratos".</p></div>`;
      form.reset();
      garantesList.innerHTML = "";
      onSaved();
    } catch (err) {
      resultBox.style.display = "block";
      resultBox.innerHTML = `<div class="admin-card" style="border-color:var(--color-danger);"><h2>❌ No se pudo guardar</h2><p>${err.message || err}</p></div>`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Guardar contrato";
    }
  });

  /* --------------------------- Listado de contratos --------------------- */

  const ESTADO_LABEL = { vigente: "Vigente", vencido: "Vencido", rescindido: "Rescindido", renovado: "Renovado" };

  async function loadList() {
    listBox.innerHTML = `<p style="color:var(--color-text-light);">Cargando…</p>`;
    const { data, error } = await supabaseClient
      .from("contratos")
      .select("*, propiedades(codigo, titulo_publico, calle, barrio), personas(nombre)")
      .order("creado_en", { ascending: false });

    if (error) {
      listBox.innerHTML = `<p style="color:var(--color-danger);">No se pudo cargar la lista: ${error.message}</p>`;
      return;
    }
    if (!data || data.length === 0) {
      listBox.innerHTML = `<p style="color:var(--color-text-light);">Todavía no hay contratos cargados.</p>`;
      return;
    }
    cacheContratos = data;

    listBox.innerHTML = data
      .map((c) => {
        const inmueble = c.propiedades ? (c.propiedades.codigo || "") + " — " + (c.propiedades.titulo_publico || c.propiedades.calle || c.propiedades.barrio || "") : "";
        return `
      <div class="admin-list-row" style="flex-direction:column; align-items:stretch;">
        <div style="display:flex; flex-wrap:wrap; align-items:center; gap:14px;">
          <div class="admin-list-info">
            <span class="admin-list-title">${inmueble}</span>
            <span class="admin-status-badge" style="background:${c.estado === "vigente" ? "#1a9c4a" : "var(--color-text-light)"};">${ESTADO_LABEL[c.estado] || c.estado}</span>
            <span class="admin-list-meta" style="display:block;">Inquilino: ${c.personas ? c.personas.nombre : "-"} · ${c.fecha_inicio} a ${c.fecha_fin} · ${c.moneda} ${(Dinero.aPesos(c.monto_inicial) || 0).toLocaleString("es-AR")}/mes</span>
          </div>
          <div class="admin-list-actions">
            <button type="button" class="btn btn-sm btn-dark" data-ver-cuotas="${c.id}">Ver cuotas</button>
            ${c.estado === "vigente" ? `<button type="button" class="btn btn-sm" data-generar-cuotas="${c.id}">Generar cuotas pendientes</button>` : ""}
            ${c.estado === "vigente" ? `<button type="button" class="btn btn-sm btn-dark" data-renovar="${c.id}">Renovar</button>` : ""}
            ${c.estado === "vigente" ? `<button type="button" class="admin-delete-link" data-rescindir="${c.id}">Rescindir</button>` : ""}
          </div>
        </div>
        <div data-cuotas-de="${c.id}" style="display:none; margin-top:14px; padding-top:14px; border-top:1px solid var(--color-border);"></div>
      </div>`;
      })
      .join("");

    listBox.querySelectorAll("[data-ver-cuotas]").forEach((btn) => {
      btn.addEventListener("click", () => toggleCuotas(parseInt(btn.dataset.verCuotas, 10)));
    });
    listBox.querySelectorAll("[data-generar-cuotas]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const { data: res, error } = await supabaseClient.rpc("generar_cuotas_pendientes", { p_contrato_id: parseInt(btn.dataset.generarCuotas, 10) });
        btn.disabled = false;
        if (error) return alert("No se pudo generar: " + error.message);
        const r = Array.isArray(res) ? res[0] : res;
        alert(r && r.detenido_por_indice
          ? `Se generaron ${r.generadas} cuota(s) más. Se detuvo porque falta cargar un valor de índice más reciente — cargalo en "Índices BCRA" y volvé a tocar este botón.`
          : `Se generaron ${r ? r.generadas : 0} cuota(s) más.`);
        loadList();
      });
    });
    listBox.querySelectorAll("[data-rescindir]").forEach((btn) => {
      btn.addEventListener("click", () => {
        contratoParaAccion = parseInt(btn.dataset.rescindir, 10);
        rescindirForm.reset();
        document.getElementById("rescindir-form-error").style.display = "none";
        rescindirModal.style.display = "flex";
      });
    });
    listBox.querySelectorAll("[data-renovar]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const contrato = cacheContratos.find((c) => c.id === parseInt(btn.dataset.renovar, 10));
        contratoParaAccion = contrato.id;
        renovarForm.reset();
        document.getElementById("renovar-form-error").style.display = "none";
        renovarForm.elements.fecha_inicio.value = contrato.fecha_fin;
        document.getElementById("rn-indice-base-wrap").style.display = contrato.ajuste_tipo === "indice" ? "block" : "none";
        renovarModal.style.display = "flex";
      });
    });
  }

  async function toggleCuotas(contratoId) {
    const contenedor = listBox.querySelector(`[data-cuotas-de="${contratoId}"]`);
    if (!contenedor) return;
    if (contenedor.style.display === "block") {
      contenedor.style.display = "none";
      return;
    }
    contenedor.style.display = "block";
    contenedor.innerHTML = "Cargando cuotas…";
    const { data, error } = await supabaseClient
      .from("cuotas")
      .select("*")
      .eq("contrato_id", contratoId)
      .order("fecha_vencimiento");
    if (error) { contenedor.innerHTML = "No se pudo cargar: " + error.message; return; }
    if (!data.length) { contenedor.innerHTML = "Todavía no hay cuotas generadas."; return; }
    contenedor.innerHTML = `
      <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:8px; font-size:0.85rem; font-weight:700; color:var(--color-text-light); margin-bottom:6px;">
        <span>Período</span><span>Vencimiento</span><span>Monto</span><span>Estado</span>
      </div>
      ${data.map((q) => `
        <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:8px; font-size:0.9rem; padding:6px 0; border-top:1px solid var(--color-border);">
          <span>${q.periodo}</span><span>${q.fecha_vencimiento}</span>
          <span>$ ${(Dinero.aPesos(q.monto_alquiler) || 0).toLocaleString("es-AR")}</span>
          <span>${q.estado}</span>
        </div>`).join("")}
    `;
  }

  /* ------------------------------ Rescindir ----------------------------- */

  document.getElementById("rescindir-cancelar").addEventListener("click", () => { rescindirModal.style.display = "none"; });
  rescindirModal.addEventListener("click", (e) => { if (e.target === rescindirModal) rescindirModal.style.display = "none"; });

  rescindirForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById("rescindir-form-error");
    const data = new FormData(rescindirForm);
    const { error } = await supabaseClient.rpc("rescindir_contrato", {
      p_contrato_id: contratoParaAccion,
      p_fecha_rescision: data.get("fecha_rescision"),
      p_motivo: data.get("motivo"),
    });
    if (error) {
      errorBox.textContent = error.message;
      errorBox.style.display = "block";
      return;
    }
    rescindirModal.style.display = "none";
    loadList();
    AdminInmuebles.loadList();
  });

  /* ------------------------------- Renovar ------------------------------ */

  document.getElementById("renovar-cancelar").addEventListener("click", () => { renovarModal.style.display = "none"; });
  renovarModal.addEventListener("click", (e) => { if (e.target === renovarModal) renovarModal.style.display = "none"; });

  renovarForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById("renovar-form-error");
    const data = new FormData(renovarForm);
    const cambios = {
      fecha_inicio: data.get("fecha_inicio"),
      fecha_fin: data.get("fecha_fin"),
      monto_inicial: Dinero.aCentavos(data.get("monto_inicial")),
    };
    if (data.get("indice_valor_base")) cambios.indice_valor_base = V.decimal(data.get("indice_valor_base"));

    const { error } = await supabaseClient.rpc("renovar_contrato", {
      p_contrato_origen_id: contratoParaAccion,
      p_cambios: cambios,
    });
    if (error) {
      errorBox.textContent = error.message;
      errorBox.style.display = "block";
      return;
    }
    renovarModal.style.display = "none";
    loadList();
  });

  /* ------------------------------ Índices BCRA --------------------------- */

  async function loadIndices() {
    indicesListBox.innerHTML = `<p style="color:var(--color-text-light);">Cargando…</p>`;
    const { data, error } = await supabaseClient
      .from("indice_valores")
      .select("*")
      .order("indice_codigo")
      .order("fecha", { ascending: false });
    if (error) { indicesListBox.innerHTML = `<p style="color:var(--color-danger);">${error.message}</p>`; return; }
    if (!data.length) { indicesListBox.innerHTML = `<p style="color:var(--color-text-light);">Todavía no cargaste ningún valor.</p>`; return; }
    indicesListBox.innerHTML = data
      .map((v) => `
      <div class="admin-list-row">
        <div class="admin-list-info">
          <span class="admin-list-title">${v.indice_codigo}</span>
          <span class="admin-list-meta" style="display:block;">${v.fecha} · valor ${v.valor}</span>
        </div>
        <button type="button" class="admin-delete-link" data-borrar-indice="${v.id}">Eliminar</button>
      </div>`)
      .join("");
    indicesListBox.querySelectorAll("[data-borrar-indice]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("¿Eliminar este valor cargado?")) return;
        await supabaseClient.from("indice_valores").delete().eq("id", parseInt(btn.dataset.borrarIndice, 10));
        loadIndices();
      });
    });
  }

  indiceForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(indiceForm);
    const { error } = await supabaseClient.from("indice_valores").insert({
      indice_codigo: data.get("indice_codigo"),
      fecha: data.get("fecha"),
      valor: V.decimal(data.get("valor")),
    });
    if (error) return alert("No se pudo guardar: " + error.message);
    indiceForm.reset();
    loadIndices();
  });

  return {
    init({ onSaved: cb }) { onSaved = cb || (() => {}); },
    loadList,
    loadIndices,
    prepararNuevo,
  };
})();
