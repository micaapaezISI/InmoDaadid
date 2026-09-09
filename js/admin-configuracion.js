/* =====================================================================
   PATRICIA DAADIN — Panel admin: Configuración general
   ---------------------------------------------------------------------
   Valores de la tabla "config" (mora, comisión, aviso de vencimiento)
   que antes vivían sueltos dentro de Cobranzas — reglas-negocio-
   cobranzas.md (InmoGestion) ya señalaba que esto tenía que ser su
   propia pantalla, no un formulario metido en otro módulo.
   ===================================================================== */

const AdminConfiguracion = (() => {
  const CLAVES = ["punitorio_diario_pct", "dias_gracia_mora", "comision_admin_pct", "dias_aviso_vencimiento_contrato"];
  const form = document.getElementById("config-general-form");

  async function loadConfig() {
    const { data, error } = await supabaseClient.from("config").select("clave, valor").in("clave", CLAVES);
    if (error) return;
    (data || []).forEach((c) => {
      if (form.elements[c.clave]) form.elements[c.clave].value = c.valor;
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const filas = CLAVES.map((clave) => ({ clave, valor: String(V.decimal(data.get(clave)) ?? 0) }));
    const { error } = await supabaseClient.from("config").upsert(filas);
    if (error) return avisar("No se pudo guardar: " + error.message, "error");
    avisar("Configuración guardada.");
  });

  return {
    init() { loadConfig(); },
    loadConfig,
  };
})();
