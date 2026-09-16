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
  renderGallery(images, property);

  const badgeClass =
    property.operation === "venta" ? "badge-venta" : property.operation === "alquiler" ? "badge-alquiler" : "badge-temporal";

  document.getElementById("detail-body").innerHTML = `
    <div class="detail-header">
      <div class="detail-title">
        <span class="property-badge ${badgeClass}" style="position:static; display:inline-block; margin-bottom:10px;">${operationLabel(property.operation)}</span>
        <h1>${property.title}</h1>
        <div class="property-location">${property.address} · ${property.zone}</div>
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
      <a class="btn btn-whatsapp btn-block" href="https://wa.me/${WHATSAPP_NUMBER}?text=${message}" target="_blank" rel="noopener"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L4 20l1-4.6A8.5 8.5 0 1 1 21 11.5Z"/></svg> Consultar por WhatsApp</a>
      <a class="btn btn-dark btn-block" href="tel:+${WHATSAPP_NUMBER}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.8 21 3 13.2 3 4c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1L6.6 10.8Z"/></svg> Llamar ahora</a>
      <a class="btn btn-outline btn-block" style="color:var(--color-primary); border-color:var(--color-border);" href="contacto.html"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg> Enviar consulta por formulario</a>
    </div>
  `;

  // Propiedades relacionadas
  const related = PROPERTIES.filter((p) => p.id !== property.id && p.type === property.type).slice(0, 3);
  const relatedList = related.length ? related : PROPERTIES.filter((p) => p.id !== property.id).slice(0, 3);
  const relatedGrid = document.getElementById("related-grid");
  if (relatedGrid) relatedGrid.innerHTML = relatedList.map(renderPropertyCard).join("");
}

document.addEventListener("DOMContentLoaded", initPropertyDetail);

/* ===========================================================================
   GALERÍA + LIGHTBOX
   El bloque de arriba (main + 2 miniaturas) siempre muestra como máximo
   3 fotos: es solo una "vidriera". Todas las fotos de la propiedad (las
   que vinieron del .zip subido en el panel admin incluidas) quedan
   disponibles al hacer click, dentro del lightbox con flechas.
   =========================================================================== */
const GALLERY_VISIBLE_TILES = 3; // 1 foto principal + 2 miniaturas

function renderGallery(images, property) {
  const gallery = document.getElementById("detail-gallery");
  if (!gallery) return;

  if (images.length === 0) {
    gallery.innerHTML = `<div class="detail-gallery-main">${placeholderPhotoSVG(property.id % 6, typeLabel(property.type))}</div>`;
    return;
  }

  const visible = images.slice(0, GALLERY_VISIBLE_TILES);
  const remaining = images.length - visible.length;

  const sideThumbs = visible
    .slice(1)
    .map((url, i) => {
      const index = i + 1;
      const isLastVisible = index === visible.length - 1 && remaining > 0;
      return `
        <div data-gallery-index="${index}">
          <img src="${url}" alt="${property.title} — foto ${index + 1}" loading="lazy">
          ${isLastVisible ? `<span class="gallery-more-badge">+${remaining} foto${remaining === 1 ? "" : "s"}</span>` : ""}
        </div>`;
    })
    .join("");

  gallery.innerHTML = `
    <div class="detail-gallery-main" data-gallery-index="0">
      <img src="${visible[0]}" alt="${property.title}" loading="lazy">
      ${images.length > 1 ? `<button type="button" class="gallery-viewall-btn">🖼️ Ver las ${images.length} fotos</button>` : ""}
    </div>
    ${visible.length > 1 ? `<div class="detail-gallery-side">${sideThumbs}</div>` : ""}
  `;

  gallery.querySelectorAll("[data-gallery-index]").forEach((el) => {
    el.addEventListener("click", () => openLightbox(images, property.title, parseInt(el.dataset.galleryIndex, 10)));
  });
}

/* ------------------------------ Lightbox ------------------------------ */
let lightboxImages = [];
let lightboxIndex = 0;
let lightboxTitle = "";
let lightboxEl = null;

function ensureLightbox() {
  if (lightboxEl) return lightboxEl;
  const el = document.createElement("div");
  el.className = "lightbox-overlay";
  el.innerHTML = `
    <button type="button" class="lightbox-close" aria-label="Cerrar">✕</button>
    <button type="button" class="lightbox-nav lightbox-prev" aria-label="Foto anterior">‹</button>
    <div class="lightbox-img-wrap">
      <img class="lightbox-img" src="" alt="">
    </div>
    <button type="button" class="lightbox-nav lightbox-next" aria-label="Foto siguiente">›</button>
    <div class="lightbox-counter"></div>
  `;
  document.body.appendChild(el);

  el.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
  el.querySelector(".lightbox-prev").addEventListener("click", () => stepLightbox(-1));
  el.querySelector(".lightbox-next").addEventListener("click", () => stepLightbox(1));
  el.addEventListener("click", (e) => {
    if (e.target === el) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (!el.classList.contains("is-open")) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") stepLightbox(-1);
    else if (e.key === "ArrowRight") stepLightbox(1);
  });

  lightboxEl = el;
  return el;
}

function openLightbox(images, title, index) {
  if (!images.length) return;
  lightboxImages = images;
  lightboxIndex = index || 0;
  lightboxTitle = title || "";
  const el = ensureLightbox();
  updateLightbox();
  el.classList.add("is-open");
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  if (!lightboxEl) return;
  lightboxEl.classList.remove("is-open");
  document.body.style.overflow = "";
}

function stepLightbox(delta) {
  lightboxIndex = (lightboxIndex + delta + lightboxImages.length) % lightboxImages.length;
  updateLightbox();
}

function updateLightbox() {
  if (!lightboxEl) return;
  const img = lightboxEl.querySelector(".lightbox-img");
  img.src = lightboxImages[lightboxIndex];
  img.alt = lightboxTitle;
  lightboxEl.querySelector(".lightbox-counter").textContent = `${lightboxIndex + 1} / ${lightboxImages.length}`;
  const multi = lightboxImages.length > 1;
  lightboxEl.querySelector(".lightbox-prev").style.display = multi ? "flex" : "none";
  lightboxEl.querySelector(".lightbox-next").style.display = multi ? "flex" : "none";
}
