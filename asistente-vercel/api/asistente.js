// =====================================================================
// PATRICIA DAADIN — asistente virtual del sitio (Vercel)
// ---------------------------------------------------------------------
// Reemplaza a supabase/functions/asistente-bot. Lee las propiedades
// publicadas con la clave pública (la misma de js/supabase-config.js) y
// responde con Gemini. La clave de Gemini vive solo en la variable
// GEMINI_API_KEY de Vercel: nunca se expone en el sitio.
// =====================================================================

const GEMINI_MODEL = "gemini-flash-lite-latest";
const SUPABASE_URL = "https://kfwmlggzarzoakbigxbd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_4rcY_yid15wqCfMlWFdF4w__mfFGYKk";

const ORIGENES = new Set([
  "https://inmobiliariadaadin.com.ar",
  "https://www.inmobiliariadaadin.com.ar",
  "http://localhost:5500",
]);

const TIPOS = {
  casa: "Casa", departamento: "Departamento", terreno: "Terreno", local: "Local comercial",
  oficina: "Oficina", galpon: "Galpón", cochera: "Cochera", campo: "Campo", otro: "Propiedad",
};

const monto = (centavos) => (centavos / 100).toLocaleString("es-AR");

function lineaPropiedad(p) {
  const venta = p.precio_venta ? `venta ${p.moneda_venta} ${monto(p.precio_venta)}` : "venta: precio a consultar";
  const alquiler = p.precio_alquiler
    ? `alquiler ${p.moneda_alquiler} ${monto(p.precio_alquiler)}${p.operacion === "temporal" ? "/noche" : "/mes"}`
    : "alquiler: precio a consultar";
  const precio = p.operacion === "venta" ? venta : p.operacion === "ambas" ? `${venta} o ${alquiler}` : alquiler;
  const zona = p.barrio || p.localidad || "San Salvador de Jujuy";
  const titulo = p.titulo_publico || `${TIPOS[p.tipo] || "Propiedad"} en ${zona}`;
  const datos = [
    p.operacion,
    p.tipo,
    `zona ${zona}`,
    p.dormitorios ? `${p.dormitorios} dorm.` : "",
    p.banos ? `${p.banos} baños` : "",
    p.superficie_total ? `${p.superficie_total} m²` : "",
    precio,
    `estado: ${p.estado}`,
  ].filter(Boolean);
  return `- [${p.codigo}] ${titulo} — ${datos.join(", ")}`;
}

async function propiedadesContexto() {
  const campos = "codigo,tipo,operacion,estado,barrio,localidad,superficie_total,dormitorios,banos,precio_venta,moneda_venta,precio_alquiler,moneda_alquiler,titulo_publico";
  const res = await fetch(`${SUPABASE_URL}/rest/v1/propiedades?select=${campos}&publicar_web=eq.true&activo=eq.true&limit=40`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase respondió ${res.status}`);
  const filas = await res.json();
  if (!filas.length) return "No hay propiedades publicadas por el momento.";
  return filas.map(lineaPropiedad).join("\n");
}

function systemPrompt(listado) {
  return `
Sos el asistente virtual del sitio de Patricia Daadin, martillera matriculada (MP 421) en San Salvador de Jujuy.
Respondé siempre en español rioplatense, tono cercano y profesional, en mensajes cortos (2 a 4 líneas).

Reglas:
- Solo hablá de las propiedades listadas abajo. Si preguntan por algo que no está en la lista (otro barrio, otro tipo, etc.), decí que no hay una propiedad así publicada por el momento y ofrecé avisar cuando aparezca una.
- Si una propiedad de la lista tiene estado "alquilada", "vendida" o "reservada", aclarálo — no la ofrezcas como disponible.
- Si una propiedad dice "precio a consultar", no des ningún monto: invitá a consultarlo por WhatsApp.
- Para coordinar una visita, negociar precio o cualquier trámite concreto, derivá a WhatsApp: +54 9 388 583-9785.
- Si preguntan por tasar una propiedad, mencioná que hay un formulario dedicado en la página "Tasaciones" del sitio.
- Si preguntan por actualización o ajuste de alquileres, mencioná la "Calculadora" del sitio.
- Nunca inventes precios, direcciones exactas, ni asesoramiento legal. Si no sabés algo, decilo y derivá a WhatsApp.

Propiedades publicadas actualmente:
${listado}
`.trim();
}

export default async function handler(req, res) {
  const origen = req.headers.origin;
  if (ORIGENES.has(origen)) {
    res.setHeader("Access-Control-Allow-Origin", origen);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });
  // Solo responde al sitio: evita que otros usen la clave de Gemini.
  if (!ORIGENES.has(origen)) return res.status(403).json({ error: "Origen no permitido." });

  try {
    const { message, history } = req.body || {};
    if (!message || typeof message !== "string" || message.length > 2000) {
      return res.status(400).json({ error: "Falta el mensaje." });
    }
    const clave = process.env.GEMINI_API_KEY;
    if (!clave) return res.status(503).json({ error: "El asistente todavía no está configurado." });

    const listado = await propiedadesContexto();
    const contents = [
      ...(Array.isArray(history) ? history : []).slice(-10).map((h) => ({
        role: h.role === "bot" ? "model" : "user",
        parts: [{ text: String(h.text).slice(0, 2000) }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    const respuesta = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": clave },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt(listado) }] },
        contents,
        generationConfig: { maxOutputTokens: 300, temperature: 0.4 },
      }),
    });
    if (!respuesta.ok) {
      console.error("Gemini error:", await respuesta.text());
      return res.status(502).json({ error: "No se pudo generar la respuesta." });
    }
    const json = await respuesta.json();
    const text =
      json?.candidates?.[0]?.content?.parts?.[0]?.text ??
      "Perdón, no pude generar una respuesta. Escribime por WhatsApp y te ayudo directamente.";
    return res.status(200).json({ text });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error interno." });
  }
}
