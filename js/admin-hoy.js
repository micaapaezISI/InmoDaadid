/* =====================================================================
   PATRICIA DAADIN — Panel admin: "Hoy" (resumen general)
   ---------------------------------------------------------------------
   Pantalla de aterrizaje del panel: un pantallazo de cómo está todo hoy
   (caja, cobranzas atrasadas, deudas a propietarios, contratos por
   vencer, agenda del día, mensajes nuevos, inmuebles sin contrato) con
   accesos directos a cada sección. No inventa consultas nuevas: reusa
   los mismos RPC/tablas que ya usan Cobranzas, Informes, Caja, etc.
   ===================================================================== */

const AdminHoy = (() => {
  const box = document.getElementById("hoy-resumen");
  if (!box) return { init() {}, loadResumen() {} };

  function hoyISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function tile(label, value, tono, tabDestino) {
    const clickable = tabDestino ? ` data-hoy-ir="${tabDestino}" style="cursor:pointer;"` : "";
    return `
      <div class="admin-card admin-hoy-tile"${clickable} style="margin:0; padding:16px 18px;">
        <div style="font-size:0.8rem; color:var(--color-text-light);">${label}</div>
        <div style="font-size:1.55rem; font-weight:800; color:${tono || "var(--color-text)"};">${value}</div>
      </div>`;
  }

  function aviso(texto, tabDestino) {
    return `
      <div class="admin-list-row" data-hoy-ir="${tabDestino}" style="cursor:pointer;">
        <div class="admin-list-info">
          <span class="admin-list-title">⚠️ ${texto}</span>
        </div>
        <div class="admin-list-actions"><span style="color:var(--color-primary); font-weight:700;">Ver →</span></div>
      </div>`;
  }

  const QUICK_LINKS = [
    { tab: "cobranzas", ico: "💰", label: "Cobranzas" },
    { tab: "gastos", ico: "🧾", label: "Gastos" },
    { tab: "liquidaciones", ico: "🏦", label: "Liquidaciones" },
    { tab: "caja", ico: "💵", label: "Caja diaria" },
    { tab: "contratos", ico: "📄", label: "Contratos" },
    { tab: "agenda", ico: "🗓️", label: "Agenda" },
    { tab: "mensajes", ico: "📩", label: "Mensajes" },
    { tab: "ventas", ico: "🏷️", label: "Ventas" },
    { tab: "informes", ico: "📊", label: "Informes" },
    { tab: "inmuebles", ico: "🏠", label: "Inmuebles" },
  ];

  async function loadResumen() {
    box.innerHTML = `<p style="color:var(--color-text-light);">Cargando el resumen de hoy…</p>`;
    const hoy = hoyISO();

    const [cajaRes, cuotasRes, deudasRes, vencerRes, eventosRes, mensajesRes, alquiladasRes, vigentesRes, gastosRes] =
      await Promise.all([
        supabaseClient.from("movimiento_caja").select("tipo, monto, moneda, anulado").eq("fecha", hoy),
        supabaseClient.rpc("cuotas_pendientes_cobro", { p_q: null }),
        supabaseClient.rpc("informe_deudas_propietarios"),
        supabaseClient.rpc("informe_contratos_por_vencer"),
        supabaseClient.from("eventos").select("id, tipo, titulo, hora").eq("fecha", hoy).eq("estado", "pendiente").order("hora"),
        supabaseClient.from("contact_messages").select("id, name, created_at").order("created_at", { ascending: false }).limit(5),
        supabaseClient.from("propiedades").select("id, codigo, titulo_publico, calle, barrio").eq("activo", true).eq("estado", "alquilada"),
        supabaseClient.from("contratos").select("propiedad_id").eq("estado", "vigente"),
        supabaseClient.from("gastos").select("monto").eq("liquidado", false).eq("anulado", false),
      ]);

    const primerError = [cajaRes, cuotasRes, deudasRes, vencerRes, eventosRes, mensajesRes, alquiladasRes, vigentesRes, gastosRes]
      .map((r) => r.error).find(Boolean);
    if (primerError) {
      box.innerHTML = `<p style="color:var(--color-danger);">No se pudo cargar el resumen: ${primerError.message}</p>`;
      return;
    }

    // Caja de hoy (ARS — es la moneda de uso diario; USD se ve en Caja diaria).
    let ingresosHoy = 0, egresosHoy = 0;
    (cajaRes.data || []).filter((m) => !m.anulado && m.moneda === "ARS").forEach((m) => {
      if (m.tipo === "ingreso") ingresosHoy += m.monto; else egresosHoy += m.monto;
    });
    const saldoHoy = ingresosHoy - egresosHoy;

    // Cobranzas pendientes / atrasadas.
    const cuotas = cuotasRes.data || [];
    const atrasadas = cuotas.filter((c) => c.dias_atraso > 0).length;

    // Deuda total a propietarios (cobros sin liquidar + liquidaciones pendientes de pago).
    const deudas = deudasRes.data || [];
    const deudaTotal = deudas.reduce((acc, d) => acc + (d.deuda_total || 0), 0);
    const conAvisoUsd = deudas.filter((d) => d.aviso_usd).length;

    // Contratos que vencen dentro de 30 días.
    const porVencer = (vencerRes.data || []).filter((c) => c.dias_restantes <= 30);

    // Agenda de hoy.
    const eventosHoy = eventosRes.data || [];

    // Mensajes de contacto recientes (últimos 7 días).
    const haceUnaSemana = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const mensajesRecientes = (mensajesRes.data || []).filter((m) => new Date(m.created_at) >= haceUnaSemana);

    // Inmuebles marcados "alquilada" sin contrato vigente que lo respalde.
    const conContrato = new Set((vigentesRes.data || []).map((c) => c.propiedad_id));
    const sinContrato = (alquiladasRes.data || []).filter((p) => !conContrato.has(p.id));

    // Gastos pendientes de liquidar.
    const gastosPend = gastosRes.data || [];
    const gastosPendMonto = gastosPend.reduce((acc, g) => acc + g.monto, 0);

    const avisos = [];
    if (atrasadas > 0) avisos.push(aviso(`${atrasadas} cuota${atrasadas === 1 ? "" : "s"} atrasada${atrasadas === 1 ? "" : "s"} de cobro.`, "cobranzas"));
    if (deudaTotal > 0) avisos.push(aviso(`Hay ${Dinero.formatear(deudaTotal, "ARS")} pendiente de liquidar a propietarios.`, "liquidaciones"));
    if (conAvisoUsd > 0) avisos.push(aviso(`${conAvisoUsd} propietario${conAvisoUsd === 1 ? "" : "s"} con deuda en USD — revisar a mano.`, "liquidaciones"));
    if (porVencer.length > 0) avisos.push(aviso(`${porVencer.length} contrato${porVencer.length === 1 ? "" : "s"} vence${porVencer.length === 1 ? "" : "n"} dentro de 30 días.`, "contratos"));
    if (sinContrato.length > 0) avisos.push(aviso(`${sinContrato.length} inmueble${sinContrato.length === 1 ? "" : "s"} marcado${sinContrato.length === 1 ? "" : "s"} "alquilada" sin contrato vigente.`, "contratos"));
    if (gastosPend.length > 0) avisos.push(aviso(`${gastosPend.length} gasto${gastosPend.length === 1 ? "" : "s"} pendiente${gastosPend.length === 1 ? "" : "s"} de liquidar (${Dinero.formatear(gastosPendMonto, "ARS")}).`, "gastos"));
    if (mensajesRecientes.length > 0) avisos.push(aviso(`${mensajesRecientes.length} consulta${mensajesRecientes.length === 1 ? "" : "s"} nueva${mensajesRecientes.length === 1 ? "" : "s"} por el formulario de contacto (últimos 7 días).`, "mensajes"));

    box.innerHTML = `
      <div class="admin-hoy-tiles" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:14px; margin-bottom:22px;">
        ${tile("Saldo de caja hoy (ARS)", Dinero.formatear(saldoHoy, "ARS"), saldoHoy >= 0 ? "#1a9c4a" : "var(--color-danger)", "caja")}
        ${tile("Cuotas pendientes de cobro", cuotas.length, cuotas.length ? undefined : "#1a9c4a", "cobranzas")}
        ${tile("De esas, atrasadas", atrasadas, atrasadas ? "var(--color-danger)" : "#1a9c4a", "cobranzas")}
        ${tile("Deuda a propietarios", Dinero.formatear(deudaTotal, "ARS"), deudaTotal ? "#c98a1c" : "#1a9c4a", "liquidaciones")}
        ${tile("Gastos sin liquidar", gastosPend.length, gastosPend.length ? "#c98a1c" : "#1a9c4a", "gastos")}
        ${tile("Contratos por vencer (30 días)", porVencer.length, porVencer.length ? "#c98a1c" : "#1a9c4a", "contratos")}
        ${tile("Eventos de agenda hoy", eventosHoy.length, undefined, "agenda")}
        ${tile("Consultas nuevas (7 días)", mensajesRecientes.length, undefined, "mensajes")}
      </div>

      <div class="admin-card" style="margin-bottom:22px;">
        <h2 style="font-size:1.05rem; margin-bottom:12px;">${avisos.length ? "Cosas para revisar" : "✅ Todo al día"}</h2>
        ${avisos.length ? avisos.join("") : `<p style="color:var(--color-text-light);">No hay cobranzas atrasadas, deudas pendientes, contratos por vencer ni mensajes sin revisar.</p>`}
      </div>

      <div class="admin-card" style="margin-bottom:22px;">
        <h2 style="font-size:1.05rem; margin-bottom:12px;">🗓️ Agenda de hoy</h2>
        ${eventosHoy.length
          ? eventosHoy.map((ev) => `<div class="admin-list-row"><div class="admin-list-info"><span class="admin-list-title">${ev.hora ? ev.hora + " — " : ""}${ev.titulo}</span></div></div>`).join("")
          : `<p style="color:var(--color-text-light);">No tenés eventos agendados para hoy.</p>`}
      </div>

      <div class="admin-card" style="margin-bottom:22px;">
        <h2 style="font-size:1.05rem; margin-bottom:12px;">📩 Últimas consultas</h2>
        ${(mensajesRes.data || []).length
          ? (mensajesRes.data || []).map((m) => `<div class="admin-list-row"><div class="admin-list-info"><span class="admin-list-title">${m.name}</span><span class="admin-list-meta" style="display:block;">${Fecha.formatear(m.created_at.slice(0, 10))}</span></div></div>`).join("")
          : `<p style="color:var(--color-text-light);">Todavía no llegó ninguna consulta por el formulario.</p>`}
      </div>

      <div class="admin-card">
        <h2 style="font-size:1.05rem; margin-bottom:12px;">Ir directo a…</h2>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:10px;">
          ${QUICK_LINKS.map((l) => `<button type="button" class="btn btn-dark btn-sm" data-hoy-ir="${l.tab}" style="justify-content:flex-start;">${l.ico} ${l.label}</button>`).join("")}
        </div>
      </div>
    `;

    box.querySelectorAll("[data-hoy-ir]").forEach((el) => {
      el.addEventListener("click", () => window.adminSwitchTab(el.dataset.hoyIr));
    });
  }

  return {
    init: loadResumen,
    loadResumen,
  };
})();
