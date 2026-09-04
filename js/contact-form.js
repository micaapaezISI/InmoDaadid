/* =====================================================================
   PATRICIA DAADIN — formulario de contacto
   ---------------------------------------------------------------------
   El mensaje se guarda en la tabla "contact_messages" de Supabase y,
   además, se abre WhatsApp con los datos cargados para el contacto
   inmediato.
   ===================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("contact-form");
  if (!form) return;

  const feedback = document.getElementById("contact-feedback");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const name = data.get("name") || "";
    const phone = data.get("phone") || "";
    const email = data.get("email") || "";
    const reason = data.get("reason") || "";
    const message = data.get("message") || "";

    const { error } = await supabaseClient.from("contact_messages").insert({ name, phone, email, reason, message });
    if (error) console.error("No se pudo guardar el mensaje de contacto:", error);

    const text = encodeURIComponent(
      `Hola, soy ${name}.\n` +
        (reason ? `Motivo: ${reason}\n` : "") +
        `Teléfono: ${phone}\n` +
        (email ? `Email: ${email}\n` : "") +
        `Mensaje: ${message}`
    );

    const whatsappNumber = "5493885839785";
    window.open(`https://wa.me/${whatsappNumber}?text=${text}`, "_blank");

    if (feedback) {
      feedback.style.display = "block";
      feedback.textContent = "¡Gracias! Te estamos redirigiendo a WhatsApp para enviar tu consulta.";
    }
    form.reset();
  });
});
