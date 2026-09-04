/* =====================================================================
   PATRICIA DAADIN — Widget de carga de fotos (panel admin)
   ---------------------------------------------------------------------
   - Selección múltiple de imágenes, sin límite de cantidad.
   - Acepta también archivos .zip: se extraen todas las imágenes que
     contenga (usando js/vendor/zip-lite.js, sin librerías externas).
   - Eliminar fotos: una por una, o varias seleccionadas a la vez.
   - Reordenar arrastrando las miniaturas (drag & drop), con flechas
     ◀ ▶ como alternativa accesible / para pantallas táctiles.
   - La primera foto de la lista es la "portada" (imagen 1). Se puede
     arrastrar una foto al primer lugar, o usar el botón ⭐.

   Es un componente 100% front-end: mientras no haya un backend/CMS
   detrás, las fotos viven en la memoria del navegador durante la
   carga del formulario (no se suben a ningún servidor todavía).
   ===================================================================== */

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|bmp)$/i;

function createPhotoManager(rootEl) {
  const fileInput = rootEl.querySelector("[data-pm-file-input]");
  const dropzone = rootEl.querySelector("[data-pm-dropzone]");
  const browseBtn = rootEl.querySelector("[data-pm-browse-btn]");
  const grid = rootEl.querySelector("[data-pm-grid]");
  const toolbar = rootEl.querySelector("[data-pm-toolbar]");
  const countLabel = rootEl.querySelector("[data-pm-count]");
  const hint = rootEl.querySelector("[data-pm-hint]");
  const bulkActions = rootEl.querySelector("[data-pm-bulk-actions]");
  const selectedCountLabel = rootEl.querySelector("[data-pm-selected-count]");
  const deleteSelectedBtn = rootEl.querySelector("[data-pm-delete-selected]");
  const clearSelectionBtn = rootEl.querySelector("[data-pm-clear-selection]");
  const statusEl = rootEl.querySelector("[data-pm-status]");

  let images = []; // { id, url, name, fromZip, selected }
  let nextId = 1;
  let dragFromId = null;

  function setStatus(message, isError) {
    if (!statusEl) return;
    if (!message) {
      statusEl.style.display = "none";
      statusEl.textContent = "";
      return;
    }
    statusEl.style.display = "block";
    statusEl.textContent = message;
    statusEl.style.color = isError ? "var(--color-danger)" : "var(--color-text-light)";
  }

  function addImage(url, name, fromZip) {
    images.push({ id: nextId++, url, name, fromZip: !!fromZip, selected: false });
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    let zipCount = 0;
    let imageCount = 0;
    let errors = 0;

    setStatus("Procesando archivos…", false);

    for (const file of files) {
      const isZip =
        file.name.toLowerCase().endsWith(".zip") ||
        file.type === "application/zip" ||
        file.type === "application/x-zip-compressed";

      if (isZip) {
        try {
          const buffer = await file.arrayBuffer();
          const entries = await window.ZipLite.unzip(buffer);
          if (entries.length === 0) {
            errors++;
            console.warn(`El .zip "${file.name}" no tiene imágenes reconocibles adentro.`);
          }
          for (const entry of entries) {
            const blob = new Blob([entry.bytes], { type: entry.mime });
            addImage(URL.createObjectURL(blob), entry.name, true);
            zipCount++;
          }
        } catch (err) {
          errors++;
          console.error(`No se pudo leer el .zip "${file.name}":`, err);
        }
      } else if (file.type.startsWith("image/") || IMAGE_EXTENSIONS.test(file.name)) {
        addImage(URL.createObjectURL(file), file.name, false);
        imageCount++;
      } else {
        errors++;
      }
    }

    const parts = [];
    if (imageCount) parts.push(`${imageCount} foto${imageCount === 1 ? "" : "s"}`);
    if (zipCount) parts.push(`${zipCount} foto${zipCount === 1 ? "" : "s"} extraída${zipCount === 1 ? "" : "s"} de .zip`);
    let message = parts.length ? `Se agregaron ${parts.join(" y ")}.` : "";
    if (errors) message += (message ? " " : "") + `${errors} archivo${errors === 1 ? "" : "s"} no se pudo${errors === 1 ? "" : "ieron"} procesar.`;
    setStatus(message, errors > 0 && parts.length === 0);

    render();
  }

  function deleteImage(id) {
    const img = images.find((i) => i.id === id);
    if (img && img.url.startsWith("blob:")) URL.revokeObjectURL(img.url);
    images = images.filter((i) => i.id !== id);
    render();
  }

  function deleteSelected() {
    const toDelete = images.filter((i) => i.selected);
    toDelete.forEach((i) => {
      if (i.url.startsWith("blob:")) URL.revokeObjectURL(i.url);
    });
    images = images.filter((i) => !i.selected);
    render();
  }

  function moveTo(id, targetIndex) {
    const fromIndex = images.findIndex((i) => i.id === id);
    if (fromIndex === -1) return;
    const clamped = Math.max(0, Math.min(images.length - 1, targetIndex));
    const [item] = images.splice(fromIndex, 1);
    images.splice(clamped, 0, item);
    render();
  }

  function moveBy(id, delta) {
    const fromIndex = images.findIndex((i) => i.id === id);
    if (fromIndex === -1) return;
    moveTo(id, fromIndex + delta);
  }

  function makeCover(id) {
    moveTo(id, 0);
  }

  function toggleSelect(id, checked) {
    const img = images.find((i) => i.id === id);
    if (img) img.selected = checked;
    updateBulkBar();
  }

  function updateBulkBar() {
    const selectedCount = images.filter((i) => i.selected).length;
    if (bulkActions) bulkActions.style.display = selectedCount > 0 ? "flex" : "none";
    if (selectedCountLabel) selectedCountLabel.textContent = `${selectedCount} seleccionada${selectedCount === 1 ? "" : "s"}`;
  }

  function render() {
    if (countLabel) countLabel.textContent = `${images.length} foto${images.length === 1 ? "" : "s"} cargada${images.length === 1 ? "" : "s"}`;
    if (toolbar) toolbar.style.display = images.length > 0 ? "flex" : "none";
    if (hint) hint.style.display = images.length > 0 ? "block" : "none";

    grid.innerHTML = images
      .map(
        (img, index) => `
      <div class="pm-thumb${img.selected ? " is-selected" : ""}" draggable="true" data-pm-thumb-id="${img.id}">
        <div class="pm-thumb-media">
          <img src="${img.url}" alt="${img.name}" loading="lazy" draggable="false">
          ${index === 0 ? `<span class="pm-thumb-badge">⭐ Portada</span>` : `<span class="pm-thumb-index">${index + 1}</span>`}
          <label class="pm-thumb-select" title="Seleccionar">
            <input type="checkbox" data-pm-select="${img.id}" ${img.selected ? "checked" : ""}>
          </label>
        </div>
        <div class="pm-thumb-actions">
          <button type="button" data-pm-action="left" data-pm-id="${img.id}" title="Mover a la izquierda" ${index === 0 ? "disabled" : ""}>◀</button>
          <button type="button" data-pm-action="cover" data-pm-id="${img.id}" title="Usar como portada" ${index === 0 ? "disabled" : ""}>⭐</button>
          <button type="button" data-pm-action="right" data-pm-id="${img.id}" title="Mover a la derecha" ${index === images.length - 1 ? "disabled" : ""}>▶</button>
          <button type="button" data-pm-action="delete" data-pm-id="${img.id}" title="Eliminar" class="pm-thumb-delete">✕</button>
        </div>
        <span class="pm-thumb-name" title="${img.name}">${img.name}</span>
      </div>`
      )
      .join("");

    updateBulkBar();
  }

  // --- Eventos: elegir archivos ---
  if (browseBtn) browseBtn.addEventListener("click", () => fileInput.click());
  if (dropzone) {
    dropzone.addEventListener("click", (e) => {
      if (e.target === browseBtn) return;
      fileInput.click();
    });
    dropzone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileInput.click();
      }
    });
  }
  fileInput.addEventListener("change", (e) => {
    handleFiles(e.target.files);
    fileInput.value = ""; // permite volver a elegir el mismo archivo más adelante
  });

  // --- Drag & drop de archivos del sistema (subir) ---
  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("is-dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("is-dragover");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  });

  // --- Acciones sobre miniaturas (delegación de eventos) ---
  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-pm-action]");
    if (!btn) return;
    const id = parseInt(btn.dataset.pmId, 10);
    const action = btn.dataset.pmAction;
    if (action === "delete") deleteImage(id);
    else if (action === "cover") makeCover(id);
    else if (action === "left") moveBy(id, -1);
    else if (action === "right") moveBy(id, 1);
  });

  grid.addEventListener("change", (e) => {
    const checkbox = e.target.closest("[data-pm-select]");
    if (!checkbox) return;
    toggleSelect(parseInt(checkbox.dataset.pmSelect, 10), checkbox.checked);
  });

  if (deleteSelectedBtn) deleteSelectedBtn.addEventListener("click", deleteSelected);
  if (clearSelectionBtn) {
    clearSelectionBtn.addEventListener("click", () => {
      images.forEach((i) => (i.selected = false));
      render();
    });
  }

  // --- Reordenar arrastrando miniaturas ---
  grid.addEventListener("dragstart", (e) => {
    const thumb = e.target.closest(".pm-thumb");
    if (!thumb) return;
    dragFromId = parseInt(thumb.dataset.pmThumbId, 10);
    thumb.classList.add("is-dragging");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(dragFromId));
    }
  });

  grid.addEventListener("dragend", (e) => {
    const thumb = e.target.closest(".pm-thumb");
    if (thumb) thumb.classList.remove("is-dragging");
    grid.querySelectorAll(".pm-thumb.is-drag-over").forEach((el) => el.classList.remove("is-drag-over"));
    dragFromId = null;
  });

  grid.addEventListener("dragover", (e) => {
    const thumb = e.target.closest(".pm-thumb");
    if (!thumb || dragFromId === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    thumb.classList.add("is-drag-over");
  });

  grid.addEventListener("dragleave", (e) => {
    const thumb = e.target.closest(".pm-thumb");
    if (thumb) thumb.classList.remove("is-drag-over");
  });

  grid.addEventListener("drop", (e) => {
    const thumb = e.target.closest(".pm-thumb");
    if (!thumb || dragFromId === null) return;
    e.preventDefault();
    thumb.classList.remove("is-drag-over");
    const targetId = parseInt(thumb.dataset.pmThumbId, 10);
    const targetIndex = images.findIndex((i) => i.id === targetId);
    if (targetIndex !== -1) moveTo(dragFromId, targetIndex);
  });

  render();

  return {
    getImages: () => images.map((i) => ({ name: i.name, url: i.url, fromZip: i.fromZip })),
    getCount: () => images.length,
    setImages: (list) => {
      images = (list || []).map((it) => ({ id: nextId++, url: it.url, name: it.name || "foto", fromZip: false, selected: false }));
      render();
    },
    reset: () => {
      images.forEach((i) => {
        if (i.url.startsWith("blob:")) URL.revokeObjectURL(i.url);
      });
      images = [];
      render();
    },
  };
}
