// =====================================================================
// PATRICIA DAADIN — asistente virtual del sitio
// ---------------------------------------------------------------------
// Responde preguntas de visitantes usando gemini-flash-lite-latest,
// el modelo de Google que se mantiene gratis hasta varios cientos de
// consultas por día (más que suficiente para este sitio). La clave
// vive solo en el secret GEMINI_API_KEY de este proyecto — nunca se
// expone en el sitio público, a diferencia de la anon key.
// =====================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL = "gemini-flash-lite-latest";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function propiedadesContexto(): Promise<string> {
  const { data } = await supabase
    .from("propiedades")
    .select(
      "codigo, tipo, operacion, estado, barrio, superficie_total, dormitorios, banos, precio_venta, moneda_venta, precio_alquiler, moneda_alquiler, titulo_publico"
    )
    .eq("publicar_web", true)
    .eq("activo", true)
    .limit(40);

  if (!data || !data.length) return "No hay propiedades publicadas por el momento.";

  return data
    .map((p) => {
      const precio =
        p.operacion === "venta"
          ? `${p.moneda_venta} ${p.precio_venta?.toLocaleString("es-AR")}`
          : `${p.moneda_alquiler} ${p.precio_alquiler?.toLocaleString("es-AR")}/mes`;
      return `- [${p.codigo}] ${p.titulo_publico} — ${p.operacion}, ${p.tipo}, barrio ${p.barrio}, ${p.dormitorios ?? "?"} dorm., ${p.superficie_total ?? "?"} m², ${precio}, estado: ${p.estado}`;
    })
    .join("\n");
}

function systemPrompt(listado: string): string {
  return `
Sos el asistente virtual del sitio de Patricia Daadin, martillera matriculada (MP 421) en San Salvador de Jujuy.
Respondé siempre en español rioplatense, tono cercano y profesional, en mensajes cortos (2 a 4 líneas).

Reglas:
- Solo hablá de las propiedades listadas abajo. Si preguntan por algo que no está en la lista (otro barrio, otro tipo, etc.), decí que no hay una propiedad así publicada por el momento y ofrecé avisar cuando aparezca una.
- Si una propiedad de la lista tiene estado "alquilada", "vendida" o "reservada", aclarálo — no la ofrezcas como disponible.
- Para coordinar una visita, negociar precio o cualquier trámite concreto, derivá a WhatsApp: +54 9 388 583-9785.
- Si preguntan por tasar una propiedad, mencioná que hay un formulario dedicado en la página "Tasaciones" del sitio.
- Si preguntan por actualización o ajuste de alquileres, mencioná la "Calculadora" del sitio.
- Nunca inventes precios, direcciones exactas, ni asesoramiento legal. Si no sabés algo, decilo y derivá a WhatsApp.

Propiedades publicadas actualmente:
${listado}
`.trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { message, history } = await req.json();
    if (!message || typeof message !== "string" || message.length > 2000) {
      return new Response(JSON.stringify({ error: "Falta el mensaje." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "El asistente todavía no está configurado." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const listado = await propiedadesContexto();

    const contents = [
      ...(Array.isArray(history) ? history : [])
        .slice(-10)
        .map((h: { role: string; text: string }) => ({
          role: h.role === "bot" ? "model" : "user",
          parts: [{ text: String(h.text).slice(0, 2000) }],
        })),
      { role: "user", parts: [{ text: message }] },
    ];

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt(listado) }] },
          contents,
          generationConfig: { maxOutputTokens: 300, temperature: 0.4 },
        }),
      }
    );

    if (!res.ok) {
      console.error("Gemini error:", await res.text());
      return new Response(JSON.stringify({ error: "No se pudo generar la respuesta." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await res.json();
    const text =
      json?.candidates?.[0]?.content?.parts?.[0]?.text ??
      "Perdón, no pude generar una respuesta. Escribime por WhatsApp y te ayudo directamente.";

    return new Response(JSON.stringify({ text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Error interno." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
