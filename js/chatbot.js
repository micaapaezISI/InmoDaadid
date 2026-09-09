/* =====================================================================
   PATRICIA DAADIN — asistente virtual (widget de chat)
   ---------------------------------------------------------------------
   Inyecta la burbuja + el panel de chat en cualquier página que cargue
   este script. Llama a la Edge Function "asistente-bot" de Supabase,
   que es la única que tiene la clave de la IA — este archivo nunca
   maneja ninguna clave de IA.
   ===================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  if (typeof SUPABASE_URL === "undefined" || typeof SUPABASE_ANON_KEY === "undefined") return;

  const history = [];
  let sending = false;

  const wrap = document.createElement("div");
  wrap.className = "chatbot-wrap";
  wrap.innerHTML = `
    <button type="button" class="chatbot-toggle" id="chatbot-toggle" aria-label="Abrir asistente virtual">💬</button>
    <div class="chatbot-panel" id="chatbot-panel" hidden>
      <div class="chatbot-header">
        <div>
          <strong>Asistente virtual</strong>
          <span>Patricia Daadin</span>
        </div>
        <button type="button" class="chatbot-close" id="chatbot-close" aria-label="Cerrar">✕</button>
      </div>
      <div class="chatbot-messages" id="chatbot-messages"></div>
      <form class="chatbot-form" id="chatbot-form">
        <input type="text" id="chatbot-input" placeholder="Escribí tu pregunta..." autocomplete="off" maxlength="500" required>
        <button type="submit" aria-label="Enviar">➤</button>
      </form>
      <p class="chatbot-disclaimer">Respuestas automáticas. Para coordinar una visita o negociar, escribime por WhatsApp.</p>
    </div>
  `;
  document.body.appendChild(wrap);

  const toggleBtn = document.getElementById("chatbot-toggle");
  const closeBtn = document.getElementById("chatbot-close");
  const panel = document.getElementById("chatbot-panel");
  const messagesBox = document.getElementById("chatbot-messages");
  const form = document.getElementById("chatbot-form");
  const input = document.getElementById("chatbot-input");

  function addMessage(role, text) {
    const bubble = document.createElement("div");
    bubble.className = `chatbot-bubble chatbot-bubble--${role}`;
    bubble.textContent = text;
    messagesBox.appendChild(bubble);
    messagesBox.scrollTop = messagesBox.scrollHeight;
  }

  function addTyping() {
    const bubble = document.createElement("div");
    bubble.className = "chatbot-bubble chatbot-bubble--bot chatbot-bubble--typing";
    bubble.id = "chatbot-typing";
    bubble.textContent = "Escribiendo…";
    messagesBox.appendChild(bubble);
    messagesBox.scrollTop = messagesBox.scrollHeight;
  }

  function removeTyping() {
    const el = document.getElementById("chatbot-typing");
    if (el) el.remove();
  }

  let opened = false;
  toggleBtn.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden && !opened) {
      opened = true;
      addMessage(
        "bot",
        "¡Hola! Soy el asistente virtual de Patricia Daadin. Puedo ayudarte a encontrar una propiedad, o contarte sobre tasaciones y actualización de alquileres. ¿En qué te ayudo?"
      );
    }
    if (!panel.hidden) input.focus();
  });

  closeBtn.addEventListener("click", () => {
    panel.hidden = true;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message || sending) return;

    addMessage("user", message);
    history.push({ role: "user", text: message });
    input.value = "";
    sending = true;
    addTyping();

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/asistente-bot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ message, history: history.slice(0, -1) }),
      });
      const data = await res.json();
      removeTyping();

      if (!res.ok || !data.text) throw new Error(data.error || "Sin respuesta");

      addMessage("bot", data.text);
      history.push({ role: "bot", text: data.text });
    } catch (err) {
      removeTyping();
      addMessage(
        "bot",
        "Perdón, no pude responder en este momento. Escribime por WhatsApp y te ayudo directamente: +54 9 388 583-9785."
      );
    } finally {
      sending = false;
    }
  });
});
