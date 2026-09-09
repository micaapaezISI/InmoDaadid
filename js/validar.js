/* =====================================================================
   PATRICIA DAADIN — validación y montos (portado de InmoGestion:
   src/utils/validar.js + src/utils/dinero.js, adaptado a JS de navegador)
   Los montos se guardan en centavos (entero) en Supabase — nunca en
   decimales, para no acumular errores de redondeo.
   ===================================================================== */

const V = {
  texto(valor, { max = 255 } = {}) {
    if (valor === null || valor === undefined) return null;
    const limpio = String(valor).trim();
    if (limpio === "") return null;
    return limpio.slice(0, max);
  },

  entero(valor) {
    if (valor === null || valor === undefined || valor === "") return null;
    const n = parseInt(valor, 10);
    return Number.isFinite(n) ? n : null;
  },

  decimal(valor) {
    if (valor === null || valor === undefined || valor === "") return null;
    const n = Number(String(valor).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  },

  unoDe(valor, opciones, porDefecto = null) {
    return opciones.includes(valor) ? valor : porDefecto;
  },

  soloDigitos(valor) {
    return String(valor || "").replace(/\D/g, "");
  },

  emailValido(valor) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(valor || ""));
  },

  telefonoValido(valor) {
    const digitos = V.soloDigitos(valor);
    return digitos.length >= 6 && digitos.length <= 15;
  },

  documentoValido(valor, tipo) {
    const limpio = String(valor || "").trim();
    if (tipo === "CUIT" || tipo === "CUIL") return V.soloDigitos(limpio).length === 11;
    if (tipo === "PAS") return limpio.length >= 5 && limpio.length <= 15;
    const digitos = V.soloDigitos(limpio);
    return digitos.length >= 6 && digitos.length <= 9;
  },

  mensajeDocumentoInvalido(tipo) {
    if (tipo === "CUIT" || tipo === "CUIL") {
      return `Ese ${tipo} no parece válido — tiene que tener 11 números (podés escribirlo con guiones).`;
    }
    if (tipo === "PAS") return "Ese número de pasaporte no parece válido.";
    return `Ese ${tipo} no parece válido — tiene que tener entre 6 y 9 números.`;
  },
};

const Fecha = {
  // "2026-01-05" -> "05/01/2026". Si no viene con esa forma (o viene
  // vacío), se devuelve tal cual para no mostrar "undefined" en la UI.
  formatear(fechaISO) {
    if (!fechaISO) return "";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fechaISO));
    if (!m) return fechaISO;
    return `${m[3]}/${m[2]}/${m[1]}`;
  },
};

// Portado de InmoGestion (public/js/api.js): si no arranca con el código
// de país, se asume número argentino y se le agrega "549" (indicativo +
// celular), sacando ceros iniciales de la característica local.
function linkWhatsApp(telefono, mensaje) {
  if (!telefono) return null;
  let numero = String(telefono).replace(/\D/g, "");
  if (!numero) return null;
  if (!numero.startsWith("54")) numero = "549" + numero.replace(/^0+/, "");
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
}

const Dinero = {
  // Acepta "1.234.567,89" (formato argentino) y "1234567.89"; siempre en pesos.
  aCentavos(valor) {
    if (valor === null || valor === undefined || valor === "") return null;
    if (typeof valor === "number") return Math.round(valor * 100);
    const limpio = String(valor).trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
    const numero = Number(limpio);
    return Number.isFinite(numero) ? Math.round(numero * 100) : null;
  },

  aPesos(centavos) {
    if (centavos === null || centavos === undefined) return null;
    return centavos / 100;
  },

  formatear(centavos, moneda = "ARS") {
    if (centavos === null || centavos === undefined) return "";
    const simbolo = moneda === "USD" ? "US$" : "$";
    return simbolo + " " + (centavos / 100).toLocaleString("es-AR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  },
};
