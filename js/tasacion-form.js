/* =====================================================================
   PATRICIA DAADIN — formulario de tasaciones
   ---------------------------------------------------------------------
   Mismo patrón que js/contact-form.js: guarda en "contact_messages" con
   reason fijo "Quiero tasar mi propiedad" (esa tabla no tiene columnas
   propias para tipo/zona/m² de la propiedad a tasar, así que van dentro
   del mensaje) y abre WhatsApp con los datos ya redactados.
   ===================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("tasacion-form");
  if (!form) return;

  const feedback = document.getElementById("tasacion-feedback");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const name = data.get("name") || "";
    const phone = data.get("phone") || "";
    const email = data.get("email") || "";
    const type = data.get("type") || "";
    const zone = data.get("zone") || "";
    const area = data.get("area") || "";
    const detalle = data.get("message") || "";

    const message =
      `Quiero tasar mi propiedad.\n` +
      `Tipo: ${type}\n` +
      (zone ? `Barrio/zona: ${zone}\n` : "") +
      (area ? `Superficie aproximada: ${area} m²\n` : "") +
      (detalle ? `Detalle: ${detalle}` : "");

    const { error } = await supabaseClient
      .from("contact_messages")
      .insert({ name, phone, email, reason: "Quiero tasar mi propiedad", message });
    if (error) console.error("No se pudo guardar la solicitud de tasación:", error);

    const text = encodeURIComponent(
      `Hola, soy ${name}. Quiero tasar mi propiedad.\n` +
        `Tipo: ${type}\n` +
        (zone ? `Barrio/zona: ${zone}\n` : "") +
        (area ? `Superficie aproximada: ${area} m²\n` : "") +
        `Teléfono: ${phone}\n` +
        (email ? `Email: ${email}\n` : "") +
        (detalle ? `Detalle: ${detalle}` : "")
    );

    const whatsappNumber = "5493885839785";
    window.open(`https://wa.me/${whatsappNumber}?text=${text}`, "_blank");

    if (feedback) {
      feedback.style.display = "block";
      feedback.textContent = "¡Gracias! Te estamos redirigiendo a WhatsApp para enviar tu solicitud.";
    }
    form.reset();
  });
});
