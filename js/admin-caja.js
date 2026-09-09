/* =====================================================================
   PATRICIA DAADIN — Panel admin: Caja diaria
   ---------------------------------------------------------------------
   Portado de src/routes/caja.js de InmoGestion. Los movimientos con
   origen automático (un cobro, un pago de liquidación, un gasto) los
   generan solos los triggers de Postgres (ver supabase/migrations/
   008_caja.sql) apenas se registran en su propio módulo — acá solo se
   lee la grilla y se cargan/anulan los movimientos sueltos (sueldos,
   retiros, ajustes).
   ===================================================================== */

const AdminCaja = (() => {
  const CATEGORIA_LABEL = {
    cobro_alquiler: "Cobro de alquiler", cobro_expensas: "Cobro de expensas",
    comision_alquiler: "Comisión de alquiler", comision_venta: "Comisión de venta",
    liquidacion_propietario: "Liquidación a propietario", gasto_propiedad: "Gasto de propiedad",
    gasto_operativo: "Gasto operativo", sueldo: "Sueldo", impuesto: "Impuesto",
    aporte: "Aporte", retiro: "Retiro", ajuste: "Ajuste", otro: "Otro",
  };
  const MEDIO_LABEL = {
    efectivo: "Efectivo", transferencia: "Transferencia", cheque: "Cheque", deposito: "Depósito",
    mercadopago: "Mercado Pago", tarjeta: "Tarjeta", digital: "Otro digital", otro: "Otro",
  };

  const form = document.getElementById("caja-form");
  const saldosHoyBox = document.getElementById("caja-saldos-hoy");
  const desdeInput = document.getElementById("cj-desde");
  const hastaInput = document.getElementById("cj-hasta");
  const filtrarBtn = document.getElementById("cj-filtrar-btn");
  const saldosRangoBox = document.getElementById("caja-saldos-rango");
  const movimientosList = document.getElementById("caja-movimientos-list");

  function hoyISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function calcularSaldos(filas) {
    const porMedio = new Map();
    filas.filter((m) => !m.anulado).forEach((m) => {
      const clave = m.medio_pago + "|" + m.moneda;
      const actual = porMedio.get(clave) || { medio_pago: m.medio_pago, moneda: m.moneda, ingresos: 0, egresos: 0 };
      if (m.tipo === "ingreso") actual.ingresos += m.monto; else actual.egresos += m.monto;
      porMedio.set(clave, actual);
    });
    return [...porMedio.values()].map((s) => ({ ...s, saldo: s.ingresos - s.egresos }));
  }

  function renderSaldos(box, saldos) {
    if (!saldos.length) {
      box.innerHTML = `<p style="color:var(--color-text-light);">Sin movimientos.</p>`;
      return;
    }
    box.innerHTML = saldos
      .map((s) => `
      <div class="admin-card" style="margin:0; padding:14px 18px; min-width:160px;">
        <div style="font-size:0.85rem; color:var(--color-text-light);">${MEDIO_LABEL[s.medio_pago] || s.medio_pago} · ${s.moneda}</div>
        <div style="font-size:1.3rem; font-weight:800;">${Dinero.formatear(s.saldo, s.moneda)}</div>
      </div>`)
      .join("");
  }

  async function loadSaldosHoy() {
    const { data, error } = await supabaseClient.from("movimiento_caja").select("tipo, monto, moneda, medio_pago, anulado").eq("fecha", hoyISO());
    if (error) { saldosHoyBox.innerHTML = `<p style="color:var(--color-danger);">${error.message}</p>`; return; }
    renderSaldos(saldosHoyBox, calcularSaldos(data || []));
  }

  async function loadMovimientos() {
    const desde = desdeInput.value || hoyISO();
    const hasta = hastaInput.value || desde;
    movimientosList.innerHTML = `<p style="color:var(--color-text-light);">Cargando…</p>`;

    const { data, error } = await supabaseClient
      .from("movimiento_caja")
      .select("*, personas(nombre), propiedades(codigo)")
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha", { ascending: false })
      .order("id", { ascending: false })
      .limit(500);
    if (error) {
      movimientosList.innerHTML = `<p style="color:var(--color-danger);">No se pudo cargar: ${error.message}</p>`;
      return;
    }

    renderSaldos(saldosRangoBox, calcularSaldos(data || []));

    if (!data || !data.length) {
      movimientosList.innerHTML = `<p style="color:var(--color-text-light);">No hay movimientos en ese rango.</p>`;
      return;
    }

    // Un cobro o un pago de liquidación partido en varios medios deja un
    // movimiento por medio, mismo pago_id/liquidacion_id — se agrupan acá
    // para no mostrar "$100.000 efectivo" + "$100.000 transferencia" de
    // la MISMA cuota como si fueran dos cobros distintos.
    const grupos = new Map();
    data.forEach((m) => {
      const clave = m.pago_id ? "pago-" + m.pago_id
        : m.liquidacion_id ? "liq-" + m.liquidacion_id
        : m.gasto_id ? "gasto-" + m.gasto_id
        : "manual-" + m.id;
      if (!grupos.has(clave)) {
        grupos.set(clave, { ...m, monto: 0, medios: new Set(), anulado: true, filaId: m.id });
      }
      const g = grupos.get(clave);
      g.monto += m.monto;
      g.medios.add(m.medio_pago);
      if (!m.anulado) g.anulado = false;
      if (m.id < g.filaId) g.filaId = m.id;
    });

    movimientosList.innerHTML = [...grupos.values()]
      .map((g) => {
        const esAutomatico = !!(g.pago_id || g.liquidacion_id || g.gasto_id);
        const medioTexto = g.medios.size > 1 ? "Varios" : (MEDIO_LABEL[[...g.medios][0]] || [...g.medios][0]);
        const quien = [g.personas ? g.personas.nombre : null, g.propiedades ? g.propiedades.codigo : null].filter(Boolean).join(" · ");
        return `
      <div class="admin-list-row">
        <div class="admin-list-info">
          <span class="admin-list-title" style="color:${g.tipo === "ingreso" ? "#1a9c4a" : "var(--color-danger)"};">
            ${g.tipo === "ingreso" ? "+" : "−"} ${Dinero.formatear(g.monto, g.moneda)}
          </span>
          ${g.anulado ? '<span class="admin-status-badge" style="background:var(--color-text-light);">Anulado</span>' : ""}
          <span class="admin-list-meta" style="display:block;">${Fecha.formatear(g.fecha)} · ${CATEGORIA_LABEL[g.categoria] || g.categoria} · ${g.concepto} · ${medioTexto}${quien ? " · " + quien : ""}</span>
        </div>
        <div class="admin-list-actions">
          ${!esAutomatico && !g.anulado ? `<button type="button" class="admin-delete-link" data-anular-movimiento="${g.filaId}">Anular</button>` : ""}
        </div>
      </div>`;
      })
      .join("");

    movimientosList.querySelectorAll("[data-anular-movimiento]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("¿Anular este movimiento?")) return;
        const { error } = await supabaseClient.rpc("anular_movimiento_caja", { p_id: parseInt(btn.dataset.anularMovimiento, 10) });
        if (error) return alert("No se pudo anular: " + error.message);
        loadMovimientos();
        loadSaldosHoy();
      });
    });
  }

  filtrarBtn.addEventListener("click", loadMovimientos);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const payload = {
      tipo: data.get("tipo"),
      categoria: data.get("categoria"),
      fecha: data.get("fecha"),
      monto: Dinero.aCentavos(data.get("monto")),
      medio_pago: data.get("medio_pago"),
      concepto: V.texto(data.get("concepto"), { max: 255 }),
    };
    if (!payload.monto) return alert("Cargá el monto.");
    if (!payload.concepto) return alert("Contá de qué se trata el movimiento.");

    const { error } = await supabaseClient.from("movimiento_caja").insert(payload);
    if (error) return alert("No se pudo guardar: " + error.message);
    form.reset();
    loadMovimientos();
    loadSaldosHoy();
  });

  return {
    init() {
      desdeInput.value = hoyISO();
      hastaInput.value = hoyISO();
      loadSaldosHoy();
    },
    loadMovimientos,
    loadSaldosHoy,
  };
})();
