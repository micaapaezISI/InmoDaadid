/* =====================================================================
   PATRICIA DAADIN — render de tarjetas y filtrado (front-end)
   Trabaja sobre el array PROPERTIES de properties-data.js.
   No hay backend: todo el filtrado se hace en el navegador sobre los
   datos de ejemplo. El día que haya un panel/API real, esta es la
   capa que hay que reemplazar por llamadas a esa fuente de datos.
   ===================================================================== */

const FAVORITES_KEY = "daadin_favoritos";

function getFavorites() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveFavorites(set) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...set]));
  } catch {
    // localStorage no disponible (modo privado, etc.) — se ignora silenciosamente
  }
}

function toggleFavorite(id) {
  const favs = getFavorites();
  const isFav = favs.has(id);
  if (isFav) favs.delete(id);
  else favs.add(id);
  saveFavorites(favs);
  return !isFav;
}

function renderPropertyCard(p) {
  const badgeClass =
    p.operation === "venta" ? "badge-venta" : p.operation === "alquiler" ? "badge-alquiler" : "badge-temporal";
  const isFav = getFavorites().has(p.id);

  return `
  <article class="property-card">
    <a href="propiedad.html?id=${p.id}" class="property-media">
      <span class="property-badge ${badgeClass}">${operationLabel(p.operation)}</span>
      <button class="property-fav${isFav ? " is-fav" : ""}" type="button" data-fav-id="${p.id}" title="Guardar" aria-label="Guardar propiedad">${isFav ? "&#9829;" : "&#9825;"}</button>
      ${propertyMediaHTML(p, typeLabel(p.type))}
    </a>
    <div class="property-body">
      <div class="property-price">${formatPrice(p)}</div>
      <a href="propiedad.html?id=${p.id}" class="property-title">${p.title}</a>
      <div class="property-location">${p.address}</div>
      <div class="property-features">
        ${p.bedrooms ? `<span>${p.bedrooms} dorm.</span>` : ""}
        ${p.bathrooms ? `<span>${p.bathrooms} baño${p.bathrooms === 1 ? "" : "s"}</span>` : ""}
        <span>${p.area} m²</span>
      </div>
      <a href="propiedad.html?id=${p.id}" class="btn btn-dark btn-sm property-cta">Ver detalle</a>
    </div>
  </article>`;
}

function renderFeatured() {
  const el = document.getElementById("featured-grid");
  if (!el) return;
  const featured = PROPERTIES.filter((p) => p.featured).slice(0, 6);
  el.innerHTML = featured.length
    ? featured.map(renderPropertyCard).join("")
    : `<p style="color:var(--color-text-light);">Todavía no hay propiedades destacadas cargadas.</p>`;
}

function applyFilters(params) {
  const priceMin = params.priceMin !== "" && params.priceMin != null ? parseFloat(params.priceMin) : null;
  const priceMax = params.priceMax !== "" && params.priceMax != null ? parseFloat(params.priceMax) : null;

  return PROPERTIES.filter((p) => {
    if (params.operation && params.operation !== "todas" && p.operation !== params.operation) return false;
    if (params.type && params.type !== "todos" && p.type !== params.type) return false;
    if (params.zone && params.zone !== "todas" && p.zone !== params.zone) return false;
    if (params.bedrooms && params.bedrooms !== "todos") {
      const min = parseInt(params.bedrooms, 10);
      if (p.bedrooms < min) return false;
    }
    // Moneda: si se elige una moneda puntual, solo entran las propiedades publicadas en esa moneda.
    if (params.currency && params.currency !== "todas" && p.currency !== params.currency) return false;

    // Precio: si se pusieron mínimo/máximo, se compara contra el precio publicado de cada propiedad
    // (en su propia moneda). Si "Moneda" quedó en "Todas", la comparación mezcla USD y ARS —
    // para un resultado exacto conviene elegir también la moneda.
    if (priceMin !== null && !Number.isNaN(priceMin) && p.price < priceMin) return false;
    if (priceMax !== null && !Number.isNaN(priceMax) && p.price > priceMax) return false;

    return true;
  });
}

function readFiltersFromForm(form) {
  const data = new FormData(form);
  return {
    operation: data.get("operation") || "todas",
    type: data.get("type") || "todos",
    zone: data.get("zone") || "todas",
    bedrooms: data.get("bedrooms") || "todos",
    currency: data.get("currency") || "todas",
    priceMin: data.get("priceMin") || "",
    priceMax: data.get("priceMax") || "",
  };
}

function renderGrid(list) {
  const grid = document.getElementById("results-grid");
  const empty = document.getElementById("empty-state");
  const count = document.getElementById("results-count");
  if (!grid) return;

  if (count) count.textContent = list.length;

  if (list.length === 0) {
    grid.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";
  grid.innerHTML = list.map(renderPropertyCard).join("");
}

function initPropertiesPage() {
  const form = document.getElementById("filters-form");
  if (!form) return;

  // Prellenar filtros con los parámetros que vengan del buscador rápido (index.html)
  const urlParams = new URLSearchParams(window.location.search);
  ["operation", "type", "zone", "bedrooms", "currency", "priceMin", "priceMax"].forEach((key) => {
    const value = urlParams.get(key);
    if (value) {
      const field = form.elements[key];
      if (field) field.value = value;
    }
  });

  function update() {
    const filters = readFiltersFromForm(form);
    renderGrid(applyFilters(filters));
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    update();
  });

  // "input" (no solo "change") para que los campos de precio filtren en vivo
  // mientras se escribe, sin esperar a que el campo pierda el foco.
  form.addEventListener("input", update);
  form.addEventListener("change", update);

  const resetBtn = document.getElementById("filters-reset");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      form.reset();
      update();
    });
  }

  update();
}

function initQuickSearch() {
  const form = document.getElementById("quick-search-form");
  if (!form) return;

  const tabs = document.querySelectorAll("#quick-search-tabs .search-tab");
  const operationSelect = form.elements["operation"];
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      if (operationSelect) operationSelect.value = tab.dataset.op || "";
    });
  });
  if (operationSelect) {
    operationSelect.addEventListener("change", () => {
      tabs.forEach((t) => t.classList.toggle("active", (t.dataset.op || "") === operationSelect.value));
    });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const params = new URLSearchParams();
    ["operation", "type", "zone", "bedrooms"].forEach((key) => {
      const value = data.get(key);
      if (value) params.set(key, value);
    });
    window.location.href = `propiedades.html?${params.toString()}`;
  });
}

function initFavoriteButtons() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".property-fav");
    if (!btn) return;
    e.preventDefault();
    const id = parseInt(btn.dataset.favId, 10);
    const nowFav = toggleFavorite(id);
    btn.classList.toggle("is-fav", nowFav);
    btn.innerHTML = nowFav ? "&#9829;" : "&#9825;";
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await fetchProperties();
  renderFeatured();
  initQuickSearch();
  initPropertiesPage();
  initFavoriteButtons();
});
