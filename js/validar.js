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
