/* =====================================================================
   PATRICIA DAADIN — render de la página de detalle de propiedad
   Lee el parámetro ?id= de la URL y busca la propiedad en PROPERTIES
   (properties-data.js). Reemplazar por una consulta a datos reales
   cuando existan.
   ===================================================================== */

const WHATSAPP_NUMBER = "5493885839785";

async function initPropertyDetail() {
  const root = document.getElementById("property-detail-root");
  if (!root) return;

  const id = parseInt(new URLSearchParams(window.location.search).get("id"), 10);
  await fetchProperties();
  const property = Number.isNaN(id) ? PROPERTIES[0] : PROPERTIES.find((p) => p.id === id);
  if (!property) {
    root.innerHTML = `<p style="padding:60px 0; text-align:center; color:var(--color-text-light);">Esta propiedad ya no está disponible. <a href="propiedades.html">Ver todas las propiedades</a>.</p>`;
    return;
  }

  document.title = `${property.title} · Patricia Daadin`;

  document.getElementById("breadcrumb-title").textContent = property.title;

  const images = property.images && property.images.length ? property.images : [];
  const mainImg = images[0]
    ? `<img src="${images[0]}" alt="${property.title}">`
    : placeholderPhotoSVG(property.id % 6, typeLabel(property.type));
  const sideImg1 = images[1] ? `<img src="${images[1]}" alt="${property.title}">` : placeholderPhotoSVG((property.id + 1) % 6, "Interior");
  const sideImg2 = images[2] ? `<img src="${images[2]}" alt="${property.title}">` : placeholderPhotoSVG((property.id + 2) % 6, "Exterior");

  document.getElementById("detail-gallery").innerHTML = `
    <div class="detail-gallery-main">${mainImg}</div>
    <div class="detail-gallery-side">
      <div>${sideImg1}</div>
      <div>${sideImg2}</div>
    </div>
  `;

  const badgeClass =
    property.operation === "venta" ? "badge-venta" : property.operation === "alquiler" ? "badge-alquiler" : "badge-temporal";

  document.getElementById("detail-body").innerHTML = `
    <div class="detail-header">
      <div class="detail-title">
        <span class="property-badge ${badgeClass}" style="position:static; display:inline-block; margin-bottom:10px;">${operationLabel(property.operation)}</span>
        <h1>${property.title}</h1>
        <div class="property-location">📍 ${property.address} · ${property.zone}</div>
      </div>
      <div class="detail-price">
        ${formatPrice(property)}
        <small>${typeLabel(property.type)}</small>
      </div>
    </div>

    <div class="detail-features">
      ${property.bedrooms ? `<div><strong>${property.bedrooms}</strong><span>Dormitorios</span></div>` : ""}
      ${property.bathrooms ? `<div><strong>${property.bathrooms}</strong><span>Baños</span></div>` : ""}
      <div><strong>${property.area}</strong><span>m²</span></div>
      <div><strong>${typeLabel(property.type)}</strong><span>Tipo</span></div>
    </div>

    <div class="detail-desc">
      <h2>Descripción</h2>
      <p>${property.description}</p>
    </div>

    <div class="detail-amenities">
      <h2>Características</h2>
      <ul class="amenities-grid">
        ${property.amenities.map((a) => `<li><span class="check-ico" style="width:20px;height:20px;font-size:0.7rem;">✓</span> ${a}</li>`).join("")}
      </ul>
    </div>
  `;

  const message = encodeURIComponent(
    `Hola, vi la propiedad "${property.title}" (código ${property.id}) en la web y quiero más información.`
  );

  document.getElementById("detail-sidebar").innerHTML = `
    <div class="sidebar-agent">
      <div class="avatar-ph">PD</div>
      <div>
        <strong>Patricia Daadin</strong>
        <span>Atención personalizada</span>
      </div>
    </div>
    <div class="sidebar-actions">
      <a class="btn btn-whatsapp btn-block" href="https://wa.me/${WHATSAPP_NUMBER}?text=${message}" target="_blank" rel="noopener">💬 Consultar por WhatsApp</a>
      <a class="btn btn-dark btn-block" href="tel:+${WHATSAPP_NUMBER}">📞 Llamar ahora</a>
      <a class="btn btn-outline btn-block" style="color:var(--color-primary); border-color:var(--color-border);" href="contacto.html">✉️ Enviar consulta por formulario</a>
    </div>
  `;

  // Propiedades relacionadas
  const related = PROPERTIES.filter((p) => p.id !== property.id && p.type === property.type).slice(0, 3);
  const relatedList = related.length ? related : PROPERTIES.filter((p) => p.id !== property.id).slice(0, 3);
  const relatedGrid = document.getElementById("related-grid");
  if (relatedGrid) relatedGrid.innerHTML = relatedList.map(renderPropertyCard).join("");
}

document.addEventListener("DOMContentLoaded", initPropertyDetail);
