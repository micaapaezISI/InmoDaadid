/* =====================================================================
   PATRICIA DAADIN — Panel admin: Informes
   ---------------------------------------------------------------------
   Portado de reglas-negocio-informes.md / src/informes/consultas.js de
   InmoGestion — catorce informes, menos dos que ya son su propia
   pantalla completa acá (Inmuebles, Liquidaciones — no se duplican). El
   cálculo de cada uno vive en una función de Postgres de solo lectura
   (ver supabase/migrations/011_informes.sql); acá solo se arma el
   selector, los filtros genéricos y una tabla genérica para mostrar
   cualquier forma de fila. Sin exportar a PDF/Excel — se imprime con el
   navegador si hace falta, mismo criterio que el recibo de Cobranzas.
   ===================================================================== */

const AdminInformes = (() => {
  const MONEDA = "moneda", FECHA = "fecha", ENTERO = "entero", TEXTO = "texto", BOOL = "bool";

  // necesita: "dias" | "periodo" | null — qué filtro genérico mostrar.
  const INFORMES = [
    {
      id: "alquileres_vigentes", nombre: "3.1 — Alquileres vigentes", necesita: null,
      columnas: [
        { key: "codigo", label: "Inmueble" }, { key: "inquilino", label: "Inquilino" },
        { key: "fecha_inicio", label: "Inicio", tipo: FECHA }, { key: "fecha_fin", label: "Fin", tipo: FECHA },
        { key: "monto_inicial", label: "Monto vigente", tipo: MONEDA }, { key: "proximo_vencimiento", label: "Próximo vencimiento de cuota", tipo: FECHA },
      ],
      cargar: async () => {
        const { data, error } = await supabaseClient.from("contratos").select("id, fecha_inicio, fecha_fin, monto_inicial, moneda, propiedades(codigo), personas(nombre)").eq("estado", "vigente").gte("fecha_fin", hoyISO());
        if (error) throw error;
        const conProximo = await Promise.all((data || []).map(async (c) => {
          const { data: cu } = await supabaseClient.from("cuotas").select("fecha_vencimiento").eq("contrato_id", c.id).eq("estado", "pendiente").order("fecha_vencimiento").limit(1);
          return { codigo: c.propiedades?.codigo, inquilino: c.personas?.nombre, fecha_inicio: c.fecha_inicio, fecha_fin: c.fecha_fin, monto_inicial: c.monto_inicial, proximo_vencimiento: cu?.[0]?.fecha_vencimiento || null };
        }));
        return conProximo;
      },
    },
    {
      id: "morosos", nombre: "3.2 — Inquilinos morosos", necesita: "dias",
      columnas: [
        { key: "nombre", label: "Inquilino" }, { key: "telefono", label: "Teléfono" },
        { key: "cantidad_cuotas", label: "Cuotas vencidas", tipo: ENTERO }, { key: "desde", label: "Desde", tipo: FECHA },
        { key: "saldo_total", label: "Saldo total", tipo: MONEDA },
      ],
      cargar: async (f) => {
        const { data, error } = await supabaseClient.rpc("informe_morosos", { p_dias_min: f.dias || 0 });
        if (error) throw error;
        return data;
      },
    },
    {
      id: "deudas_propietarios", nombre: "3.3 — Deudas a propietarios", necesita: null,
      columnas: [
        { key: "nombre", label: "Propietario" }, { key: "deuda_cobros_sin_liquidar", label: "Cobros sin liquidar", tipo: MONEDA },
        { key: "deuda_liquidaciones_pendientes", label: "Liquidaciones pendientes de pago", tipo: MONEDA },
        { key: "deuda_total", label: "Deuda total", tipo: MONEDA }, { key: "aviso_usd", label: "Aviso", tipo: BOOL },
      ],
      cargar: async () => (await supabaseClient.rpc("informe_deudas_propietarios")).data,
    },
    {
      id: "contratos_por_vencer", nombre: "3.4 — Contratos próximos a vencer", necesita: null,
      columnas: [
        { key: "propiedad_codigo", label: "Inmueble" }, { key: "inquilino", label: "Inquilino" },
        { key: "fecha_fin", label: "Vence", tipo: FECHA }, { key: "dias_restantes", label: "Días restantes", tipo: ENTERO },
      ],
      cargar: async () => (await supabaseClient.rpc("informe_contratos_por_vencer")).data,
    },
    {
      id: "liquidaciones_pendientes_generar", nombre: "3.5 — Contratos con liquidación pendiente de generar", necesita: "periodo",
      columnas: [
        { key: "propiedad_codigo", label: "Inmueble" }, { key: "propietario", label: "Propietario" },
      ],
      cargar: async (f) => {
        if (!f.periodo) throw new Error("Elegí el período.");
        const { data, error } = await supabaseClient.rpc("informe_liquidaciones_pendientes_generar", { p_periodo: f.periodo });
        if (error) throw error;
        return data;
      },
    },
    {
      id: "garantizados_pendientes", nombre: "3.6 — Pagos garantizados pendientes", necesita: null,
      columnas: [
        { key: "propiedad_codigo", label: "Inmueble" }, { key: "inquilino", label: "Inquilino" }, { key: "propietarios", label: "Propietario(s)" },
        { key: "periodo", label: "Período" }, { key: "fecha_vencimiento", label: "Vencimiento", tipo: FECHA },
        { key: "deuda_inquilino", label: "Debe el inquilino", tipo: MONEDA }, { key: "adelanto_propietario", label: "Adelantado al propietario", tipo: MONEDA },
      ],
      cargar: async () => (await supabaseClient.rpc("informe_garantizados_pendientes")).data,
    },
    {
      id: "contratos_vencidos_deuda", nombre: "3.7 — Contratos vencidos, con deuda", necesita: null,
      columnas: [
        { key: "propiedad_codigo", label: "Inmueble" }, { key: "inquilino", label: "Inquilino" },
        { key: "fecha_fin", label: "Venció", tipo: FECHA }, { key: "dias_vencido", label: "Días vencido", tipo: ENTERO }, { key: "saldo", label: "Saldo", tipo: MONEDA },
      ],
      cargar: async () => (await supabaseClient.rpc("informe_contratos_vencidos_deuda")).data,
    },
    {
      id: "personas", nombre: "3.8 — Listado de personas", necesita: null,
      columnas: [
        { key: "nombre", label: "Nombre" }, { key: "tipo_persona", label: "Tipo" },
        { key: "documento", label: "Documento" }, { key: "telefono", label: "Teléfono" }, { key: "email", label: "Email" },
      ],
      cargar: async () => (await supabaseClient.from("personas").select("nombre, tipo_persona, documento, telefono, email").eq("activo", true).order("nombre")).data,
    },
    {
      id: "seguimientos", nombre: "3.9 — Seguimientos de personas (agenda)", necesita: null,
      columnas: [
        { key: "persona", label: "Persona" }, { key: "titulo", label: "Evento" }, { key: "fecha", label: "Fecha", tipo: FECHA }, { key: "estado", label: "Estado" },
      ],
      cargar: async () => {
        const { data, error } = await supabaseClient.from("eventos").select("titulo, fecha, estado, personas(nombre)").not("persona_id", "is", null).order("fecha");
        if (error) throw error;
        return (data || []).map((e) => ({ persona: e.personas?.nombre, titulo: e.titulo, fecha: e.fecha, estado: e.estado }));
      },
    },
    {
      id: "alquileres_todos", nombre: "3.11 — Listado de alquileres (todos los estados)", necesita: null,
      columnas: [
        { key: "codigo", label: "Inmueble" }, { key: "inquilino", label: "Inquilino" }, { key: "estado", label: "Estado" },
        { key: "fecha_inicio", label: "Inicio", tipo: FECHA }, { key: "fecha_fin", label: "Fin", tipo: FECHA }, { key: "monto_inicial", label: "Monto", tipo: MONEDA },
      ],
      cargar: async () => {
        const { data, error } = await supabaseClient.from("contratos").select("estado, fecha_inicio, fecha_fin, monto_inicial, propiedades(codigo), personas(nombre)").order("creado_en", { ascending: false });
        if (error) throw error;
        return (data || []).map((c) => ({ codigo: c.propiedades?.codigo, inquilino: c.personas?.nombre, estado: c.estado, fecha_inicio: c.fecha_inicio, fecha_fin: c.fecha_fin, monto_inicial: c.monto_inicial }));
      },
    },
    {
      id: "alarmas", nombre: "3.12 — Alarmas activas", necesita: null,
      columnas: [
        { key: "origen", label: "Origen" }, { key: "descripcion", label: "Descripción" }, { key: "fecha", label: "Fecha", tipo: FECHA }, { key: "detalle", label: "Detalle" },
      ],
      cargar: async () => (await supabaseClient.rpc("informe_alarmas")).data,
    },
    {
      id: "inquilinos_por_propietario", nombre: "3.14 — Inquilinos por propietario", necesita: null,
      columnas: [
        { key: "propietario", label: "Propietario" }, { key: "propiedad_codigo", label: "Inmueble" },
        { key: "propiedad_direccion", label: "Dirección" }, { key: "inquilino", label: "Inquilino" },
      ],
      cargar: async () => (await supabaseClient.rpc("informe_inquilinos_por_propietario")).data,
    },
  ];

  const selector = document.getElementById("in-selector");
  const diasWrap = document.getElementById("in-filtro-dias-wrap");
  const diasInput = document.getElementById("in-filtro-dias");
  const periodoWrap = document.getElementById("in-filtro-periodo-wrap");
  const periodoInput = document.getElementById("in-filtro-periodo");
  const generarBtn = document.getElementById("in-generar-btn");
  const resultado = document.getElementById("informe-resultado");

  function hoyISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function poblarSelector() {
    selector.innerHTML = INFORMES.map((i) => `<option value="${i.id}">${i.nombre}</option>`).join("");
  }

  selector.addEventListener("change", actualizarFiltrosVisibles);
  function actualizarFiltrosVisibles() {
    const inf = INFORMES.find((i) => i.id === selector.value);
    diasWrap.style.display = inf?.necesita === "dias" ? "block" : "none";
    periodoWrap.style.display = inf?.necesita === "periodo" ? "block" : "none";
  }

  function formatearValor(valor, tipo) {
    if (valor === null || valor === undefined) return "—";
    if (tipo === MONEDA) return Dinero.formatear(valor);
    if (tipo === FECHA) return Fecha.formatear(valor);
    if (tipo === BOOL) return valor ? "⚠️ Sí" : "";
    return String(valor);
  }

  function renderTabla(columnas, filas) {
    if (!filas || !filas.length) {
      resultado.innerHTML = `<p style="color:var(--color-text-light);">Sin resultados.</p>`;
      return;
    }
    resultado.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
        <thead><tr>${columnas.map((c) => `<th style="text-align:left; padding:8px; border-bottom:2px solid var(--color-border);">${c.label}</th>`).join("")}</tr></thead>
        <tbody>
          ${filas.map((fila) => `<tr>${columnas.map((c) => `<td style="padding:8px; border-bottom:1px solid var(--color-border);">${formatearValor(fila[c.key], c.tipo)}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>`;
  }

  generarBtn.addEventListener("click", async () => {
    const inf = INFORMES.find((i) => i.id === selector.value);
    if (!inf) return;
    resultado.innerHTML = `<p style="color:var(--color-text-light);">Generando…</p>`;
    generarBtn.disabled = true;
    try {
      const filas = await inf.cargar({ dias: parseInt(diasInput.value, 10) || 0, periodo: periodoInput.value });
      renderTabla(inf.columnas, filas);
    } catch (err) {
      resultado.innerHTML = `<p style="color:var(--color-danger);">${err.message || err}</p>`;
    } finally {
      generarBtn.disabled = false;
    }
  });

  return {
    init() {
      poblarSelector();
      actualizarFiltrosVisibles();
    },
  };
})();
