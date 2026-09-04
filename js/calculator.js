/* =====================================================================
   PATRICIA DAADIN — Calculadora de actualización de alquileres
   ---------------------------------------------------------------------
   Conectada a la API pública de estadísticas del BCRA (api.bcra.gob.ar):
     - ICL: variable 40 "Índice para Contratos de Locación" (serie diaria,
       base 30/6/2020=1). El ajuste se calcula como la razón entre el
       valor del índice al día de hoy y el valor N meses atrás.
     - IPC: variable 27 "Inflación mensual" (% mensual, replicando el
       IPC de INDEC). El ajuste se calcula componiendo los últimos N
       valores mensuales publicados.
   "Porcentaje fijo" no usa ninguna API: es el que carga el usuario.
   ===================================================================== */

const BCRA_API_BASE = "https://api.bcra.gob.ar/estadisticas/v4.0/monetarias";
const BCRA_ICL_VARIABLE = 40;
const BCRA_IPC_VARIABLE = 27;

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function monthsBefore(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() - months);
  return d;
}

function formatDateAR(isoDate) {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

async function fetchBcraSeries(variableId, desde, hasta) {
  const url = `${BCRA_API_BASE}/${variableId}?desde=${desde}&hasta=${hasta}`;
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error("No se pudo conectar con la API del BCRA. Probá de nuevo en un momento.");
  }
  if (!res.ok) throw new Error("La API del BCRA no respondió correctamente. Probá de nuevo en un momento.");
  const json = await res.json();
  const detalle = (json.results && json.results[0] && json.results[0].detalle) || [];
  // La API devuelve el detalle de más reciente a más antiguo; lo damos vuelta.
  return detalle.slice().reverse();
}

function closestPoint(series, targetDate) {
  let best = null;
  let bestDiff = Infinity;
  for (const point of series) {
    const diff = Math.abs(new Date(point.fecha) - targetDate);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = point;
    }
  }
  return best;
}

// Ratio real ICL(hoy) / ICL(hace N meses) — el ICL no publica fines de
// semana/feriados, así que se toma el día hábil más cercano a cada fecha.
async function getIclAdjustment(months) {
  const hasta = new Date();
  const desdeTarget = monthsBefore(hasta, months);
  const ventanaDesde = new Date(desdeTarget);
  ventanaDesde.setDate(ventanaDesde.getDate() - 8);

  const series = await fetchBcraSeries(BCRA_ICL_VARIABLE, toISODate(ventanaDesde), toISODate(hasta));
  if (series.length < 2) throw new Error("El BCRA todavía no publicó suficientes datos de ICL para ese período.");

  const startPoint = closestPoint(series, desdeTarget);
  const endPoint = series[series.length - 1];

  return {
    factor: endPoint.valor / startPoint.valor - 1,
    startDate: startPoint.fecha,
    endDate: endPoint.fecha,
    sourceLabel: "ICL — BCRA",
  };
}

// Compone los últimos N valores de inflación mensual publicados por el BCRA.
async function getIpcAdjustment(months) {
  const hasta = new Date();
  const desde = monthsBefore(hasta, months + 1);

  const series = await fetchBcraSeries(BCRA_IPC_VARIABLE, toISODate(desde), toISODate(hasta));
  if (series.length === 0) throw new Error("El BCRA todavía no publicó datos de inflación mensual para ese período.");

  const recent = series.slice(-months);
  const factor = recent.reduce((acc, point) => acc * (1 + point.valor / 100), 1) - 1;

  return {
    factor,
    startDate: recent[0].fecha,
    endDate: recent[recent.length - 1].fecha,
    sourceLabel: `IPC — BCRA (${recent.length} ${recent.length === 1 ? "mes" : "meses"})`,
  };
}

function calcFixedAdjustment(fixedAnnualPct, months) {
  const annualRate = (fixedAnnualPct || 0) / 100;
  return { factor: Math.pow(1 + annualRate, months / 12) - 1, sourceLabel: "Porcentaje fijo pactado" };
}

function initCalculator() {
  const form = document.getElementById("calc-form");
  if (!form) return;

  const fixedField = document.getElementById("calc-fixed-wrap");
  const indexSelect = document.getElementById("calc-index");
  const submitBtn = form.querySelector("button[type=submit]");

  const emptyBox = document.getElementById("calc-result-empty");
  const filledBox = document.getElementById("calc-result-filled");
  const errorBox = document.getElementById("calc-result-error");
  const sourceLine = document.getElementById("calc-out-source");

  function toggleFixedField() {
    if (!fixedField) return;
    fixedField.style.display = indexSelect.value === "fijo" ? "flex" : "none";
  }

  indexSelect.addEventListener("change", toggleFixedField);
  toggleFixedField();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const amount = parseFloat(data.get("amount")) || 0;
    const indexKey = data.get("index");
    const months = parseInt(data.get("frequency"), 10) || 12;
    const fixedAnnualPct = parseFloat(data.get("fixedPct")) || 0;

    errorBox.style.display = "none";

    submitBtn.disabled = true;
    const originalBtnText = submitBtn.textContent;
    submitBtn.textContent = indexKey === "fijo" ? "Calculando…" : "Consultando al BCRA…";

    try {
      let result;
      if (indexKey === "icl") result = await getIclAdjustment(months);
      else if (indexKey === "ipc") result = await getIpcAdjustment(months);
      else result = calcFixedAdjustment(fixedAnnualPct, months);

      const increase = amount * result.factor;
      const newAmount = amount + increase;

      document.getElementById("calc-out-percent").textContent = `${(result.factor * 100).toFixed(2)}%`;
      document.getElementById("calc-out-increase").textContent = increase.toLocaleString("es-AR", {
        style: "currency",
        currency: "ARS",
        maximumFractionDigits: 0,
      });
      document.getElementById("calc-out-new").textContent = newAmount.toLocaleString("es-AR", {
        style: "currency",
        currency: "ARS",
        maximumFractionDigits: 0,
      });

      if (sourceLine) {
        sourceLine.textContent = result.startDate
          ? `Fuente: ${result.sourceLabel} · ${formatDateAR(result.startDate)} → ${formatDateAR(result.endDate)}`
          : `Fuente: ${result.sourceLabel}`;
      }

      emptyBox.style.display = "none";
      filledBox.style.display = "block";
    } catch (err) {
      console.error(err);
      errorBox.textContent = `⚠️ ${err.message}`;
      errorBox.style.display = "block";
      filledBox.style.display = "none";
      emptyBox.style.display = "none";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalBtnText;
    }
  });
}

document.addEventListener("DOMContentLoaded", initCalculator);
