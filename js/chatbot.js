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

  const STORAGE_KEY = "daadin-chatbot-state";

  function loadState() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveState() {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ history, opened, panelOpen: !panel.hidden })
      );
    } catch {
      /* sessionStorage no disponible (modo privado, etc.) */
    }
  }

  const savedState = loadState();
  const history = savedState?.history || [];
  let sending = false;

  const wrap = document.createElement("div");
  wrap.className = "chatbot-wrap";
  wrap.innerHTML = `
    <button type="button" class="chatbot-toggle" id="chatbot-toggle" aria-label="Abrir asistente virtual">🤖</button>
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

  history.forEach((entry) => addMessage(entry.role, entry.text));

  let opened = savedState?.opened || false;

  function mostrarSaludo() {
    if (opened) return;
    opened = true;
    addMessage(
      "bot",
      "¡Hola! Soy el asistente virtual de Patricia Daadin. Puedo ayudarte a encontrar una propiedad, o contarte sobre tasaciones y actualización de alquileres. ¿En qué te ayudo?"
    );
  }

  function abrirPanel({ enfocar } = {}) {
    panel.hidden = false;
    mostrarSaludo();
    if (enfocar) input.focus();
    saveState();
  }

  toggleBtn.addEventListener("click", () => {
    if (panel.hidden) abrirPanel({ enfocar: true });
    else {
      panel.hidden = true;
      saveState();
    }
  });

  closeBtn.addEventListener("click", () => {
    panel.hidden = true;
    saveState();
  });

  if (savedState?.panelOpen) {
    panel.hidden = false;
    mostrarSaludo();
  } else if (!savedState) {
    // Primera vez que se abre el sitio en esta pestaña: se muestra solo,
    // sin robarle el foco al usuario (no hace falta que esté escribiendo
    // nada todavía). Si lo cierra, no se le vuelve a abrir solo en esta
    // misma sesión — sessionStorage ya queda con panelOpen:false.
    setTimeout(() => abrirPanel(), 1500);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message || sending) return;

    addMessage("user", message);
    history.push({ role: "user", text: message });
    saveState();
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
      saveState();
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
