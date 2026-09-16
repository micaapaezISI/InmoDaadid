/* =====================================================================
   PATRICIA DAADIN — Calculadora de actualización de alquileres
   ---------------------------------------------------------------------
   Mismo modelo que las calculadoras de referencia (aRquiler y similares):
   se carga el valor INICIAL del contrato + la fecha de inicio + cada
   cuántos meses se ajusta, y se recorre el contrato ajuste por ajuste
   hasta hoy. Cada período arranca donde terminó el anterior, así que el
   monto va componiendo — no es un único porcentaje contra la fecha de hoy.

   Índices (API pública del BCRA, api.bcra.gob.ar):
     - ICL: variable 40, serie diaria de nivel (base 30/6/2020=1). El
       ajuste de cada período es ICL(fin) / ICL(inicio).
     - IPC: variable 27, inflación mensual en %. El ajuste de cada período
       compone los meses que caen dentro de ese período.
   "Porcentaje fijo" no consulta ninguna API: es el que carga el usuario.
   ===================================================================== */

const BCRA_API_BASE = "https://api.bcra.gob.ar/estadisticas/v4.0/monetarias";
const BCRA_ICL_VARIABLE = 40;
const BCRA_IPC_VARIABLE = 27;

// Tolerancia al buscar el valor del índice para una fecha: el ICL puede no
// tener publicado el día exacto, pero si el más cercano está a más de esta
// distancia es que la fecha quedó fuera de la serie.
const DIAS_TOLERANCIA_INDICE = 10;
const MS_POR_DIA = 86400000;

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseISODate(str) {
  return new Date(`${str}T00:00:00`);
}

// Suma meses anclando el día del mes: 31/01 + 1 mes = 28/02, no 03/03.
function addMonths(base, months) {
  const d = new Date(base.getFullYear(), base.getMonth() + months, 1);
  const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(base.getDate(), ultimoDia));
  return d;
}

function formatDateAR(date) {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function formatARS(value) {
  return value.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
}

function formatPct(factor) {
  return `${(factor * 100).toFixed(2)}%`;
}

// Fechas de corte del contrato: inicio, inicio+f, inicio+2f… hasta hoy.
// Devuelve también la primera que todavía no venció (la próxima actualización).
function fechasDeAjuste(inicio, frecuenciaMeses, hasta) {
  const cortes = [inicio];
  let proxima = null;
  for (let k = 1; k <= 600; k++) {
    const fecha = addMonths(inicio, frecuenciaMeses * k);
    if (fecha > hasta) {
      proxima = fecha;
      break;
    }
    cortes.push(fecha);
  }
  return { cortes, proxima };
}

async function fetchBcraSeries(variableId, desde, hasta) {
  const url = `${BCRA_API_BASE}/${variableId}?desde=${desde}&hasta=${hasta}&limit=3000`;
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

function valorIndiceEn(series, fecha) {
  let best = null;
  let bestDiff = Infinity;
  for (const point of series) {
    const diff = Math.abs(parseISODate(point.fecha) - fecha);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = point;
    }
  }
  if (!best || bestDiff > DIAS_TOLERANCIA_INDICE * MS_POR_DIA) return null;
  return best.valor;
}

async function periodosIcl(cortes, hasta) {
  const desde = new Date(cortes[0]);
  desde.setDate(desde.getDate() - DIAS_TOLERANCIA_INDICE);

  const series = await fetchBcraSeries(BCRA_ICL_VARIABLE, toISODate(desde), toISODate(hasta));
  if (series.length < 2) throw new Error("El BCRA no tiene publicado el ICL para ese período.");

  return cortes.slice(1).map((fin, i) => {
    const inicio = cortes[i];
    const vInicio = valorIndiceEn(series, inicio);
    const vFin = valorIndiceEn(series, fin);
    if (vInicio === null || vFin === null) {
      throw new Error("El BCRA no publicó el ICL para alguna de las fechas del contrato. Revisá la fecha de inicio.");
    }
    return { inicio, fin, factor: vFin / vInicio - 1 };
  });
}

async function periodosIpc(cortes, frecuenciaMeses, hasta) {
  const series = await fetchBcraSeries(BCRA_IPC_VARIABLE, toISODate(cortes[0]), toISODate(hasta));
  if (series.length === 0) throw new Error("El BCRA no tiene publicada la inflación mensual para ese período.");

  return cortes.slice(1).map((fin, i) => {
    const inicio = cortes[i];
    const meses = series.filter((p) => {
      const f = parseISODate(p.fecha);
      return f > inicio && f <= fin;
    });
    const factor = meses.reduce((acc, p) => acc * (1 + p.valor / 100), 1) - 1;
    // El IPC se publica con unas semanas de atraso: el último período puede
    // quedar con menos meses que los pactados.
    return { inicio, fin, factor, parcial: meses.length < frecuenciaMeses };
  });
}

function periodosFijos(cortes, frecuenciaMeses, porcentajeAnual) {
  const factor = Math.pow(1 + (porcentajeAnual || 0) / 100, frecuenciaMeses / 12) - 1;
  return cortes.slice(1).map((fin, i) => ({ inicio: cortes[i], fin, factor }));
}

function renderTabla(tbody, periodos, montoInicial) {
  tbody.innerHTML = periodos
    .map(
      (p) => `
      <tr${p.vigente ? ' class="is-vigente"' : ""}>
        <td>${formatDateAR(p.inicio)}</td>
        <td>${formatDateAR(p.fin)}</td>
        <td>${formatPct(p.factor)}${p.parcial ? " *" : ""}</td>
        <td>${formatARS(p.monto)}</td>
      </tr>`
    )
    .join("");

  if (periodos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4">Todavía no corresponde ninguna actualización — sigue vigente el valor inicial de ${formatARS(montoInicial)}.</td></tr>`;
  }
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
  const tableBody = document.getElementById("calc-table-body");

  function toggleFixedField() {
    if (!fixedField) return;
    fixedField.style.display = indexSelect.value === "fijo" ? "flex" : "none";
  }

  indexSelect.addEventListener("change", toggleFixedField);
  toggleFixedField();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const montoInicial = parseFloat(data.get("amount")) || 0;
    const indexKey = data.get("index");
    const frecuenciaMeses = parseInt(data.get("frequency"), 10) || 12;
    const porcentajeFijo = parseFloat(data.get("fixedPct")) || 0;
    const startDateStr = data.get("startDate");

    errorBox.style.display = "none";

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const inicio = parseISODate(startDateStr);

    if (Number.isNaN(inicio.getTime()) || inicio > hoy) {
      errorBox.textContent = "⚠️ Cargá una fecha de inicio de contrato válida (no puede ser futura).";
      errorBox.style.display = "block";
      filledBox.style.display = "none";
      return;
    }

    submitBtn.disabled = true;
    const originalBtnText = submitBtn.textContent;
    submitBtn.textContent = indexKey === "fijo" ? "Calculando…" : "Consultando al BCRA…";

    try {
      const { cortes, proxima } = fechasDeAjuste(inicio, frecuenciaMeses, hoy);

      let periodos;
      let sourceLabel;
      if (indexKey === "icl") {
        periodos = await periodosIcl(cortes, hoy);
        sourceLabel = "ICL — BCRA";
      } else if (indexKey === "ipc") {
        periodos = await periodosIpc(cortes, frecuenciaMeses, hoy);
        sourceLabel = "IPC — BCRA";
      } else {
        periodos = periodosFijos(cortes, frecuenciaMeses, porcentajeFijo);
        sourceLabel = "Porcentaje fijo pactado";
      }

      let monto = montoInicial;
      periodos.forEach((p, i) => {
        monto = monto * (1 + p.factor);
        p.monto = monto;
        p.vigente = i === periodos.length - 1;
      });

      const ultimo = periodos[periodos.length - 1];
      const acumulado = montoInicial > 0 ? monto / montoInicial - 1 : 0;

      document.getElementById("calc-out-new").textContent = formatARS(monto);
      document.getElementById("calc-out-percent").textContent = ultimo ? formatPct(ultimo.factor) : "—";
      document.getElementById("calc-out-total").textContent = formatPct(acumulado);
      document.getElementById("calc-out-next").textContent = proxima ? formatDateAR(proxima) : "—";

      renderTabla(tableBody, periodos, montoInicial);

      if (sourceLine) {
        const parcial = periodos.some((p) => p.parcial);
        sourceLine.textContent =
          `Fuente: ${sourceLabel} · contrato desde ${formatDateAR(inicio)}, ajustes cada ${frecuenciaMeses} ${frecuenciaMeses === 1 ? "mes" : "meses"}.` +
          (parcial ? " (*) Período con índice aún incompleto — el BCRA todavía no publicó todos los meses." : "");
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
