/* =====================================================================
   PATRICIA DAADIN — Panel admin (conectado a Supabase)
   ---------------------------------------------------------------------
   - Login con email/password (Supabase Auth). Solo un usuario logueado
     puede crear, editar o borrar propiedades (ver políticas RLS en
     supabase/schema.sql). El usuario admin se crea a mano desde el
     dashboard de Supabase (Authentication → Users → Add user).
   - Las fotos se suben al bucket "property-photos" de Supabase Storage
     y se guardan como URLs públicas en la columna "images".
   - Pestañas: Nueva propiedad / Mis propiedades / Destacadas / Mensajes.
   ===================================================================== */

const STORAGE_BUCKET = "property-photos";

document.addEventListener("DOMContentLoaded", () => {
  const pmRoot = document.querySelector("[data-pm-root]");
  if (!pmRoot) return;

  const photoManager = createPhotoManager(pmRoot);

  const loginWrap = document.getElementById("admin-login-wrap");
  const loginForm = document.getElementById("admin-login-form");
  const loginError = document.getElementById("admin-login-error");
  const panel = document.getElementById("admin-panel");
  const logoutBtn = document.getElementById("admin-logout");

  const tabButtons = document.querySelectorAll(".admin-tab");
  const tabPanels = document.querySelectorAll(".admin-tab-panel");

  const form = document.getElementById("admin-property-form");
  const resultBox = document.getElementById("admin-result");
  const listBox = document.getElementById("admin-properties-list");
  const featuredBox = document.getElementById("admin-featured-list");
  const messagesBox = document.getElementById("admin-messages-list");
  const submitBtn = document.getElementById("admin-submit-btn");
  const cancelEditBtn = document.getElementById("admin-cancel-edit");
  const formHeading = document.getElementById("admin-form-heading");
  const formHelp = document.getElementById("admin-form-help");

  let editingId = null;

  /* ---------------------------- Pestañas ---------------------------- */
  function switchTab(tabName) {
    tabButtons.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.tab === tabName));
    tabPanels.forEach((panelEl) => {
      panelEl.style.display = panelEl.id === `tab-panel-${tabName}` ? "block" : "none";
    });
    window.scrollTo({ top: panel.offsetTop - 20, behavior: "smooth" });
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  /* ------------------------------ Sesión ----------------------------- */
  function showLoggedIn() {
    loginWrap.style.display = "none";
    panel.style.display = "block";
    loadPropertiesList();
    loadFeaturedList();
    loadMessages();
  }

  function showLoggedOut() {
    loginWrap.style.display = "block";
    panel.style.display = "none";
  }

  supabaseClient.auth.getSession().then(({ data }) => {
    if (data.session) showLoggedIn();
    else showLoggedOut();
  });

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    if (session) showLoggedIn();
    else showLoggedOut();
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.style.display = "none";
    const data = new FormData(loginForm);
    const { error } = await supabaseClient.auth.signInWithPassword({
      email: data.get("email"),
      password: data.get("password"),
    });
    if (error) {
      loginError.textContent = "No se pudo ingresar: " + error.message;
      loginError.style.display = "block";
    } else {
      loginForm.reset();
    }
  });

  logoutBtn.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
  });

  /* --------------------------- Editar / crear ------------------------ */
  function startEdit(property) {
    editingId = property.id;
    form.elements.title.value = property.title || "";
    form.elements.operation.value = property.operation || "venta";
    form.elements.type.value = property.type || "casa";
    form.elements.bedrooms.value = property.bedrooms || 0;
    form.elements.bathrooms.value = property.bathrooms || 0;
    form.elements.area.value = property.area || "";
    form.elements.zone.value = property.zone || "Centro";
    form.elements.address.value = property.address || "";
    form.elements.currency.value = property.currency || "USD";
    form.elements.price.value = property.price || "";
    form.elements.description.value = property.description || "";
    form.elements.amenities.value = (property.amenities || []).join(", ");

    photoManager.setImages((property.images || []).map((url) => ({ url, name: url.split("/").pop() })));

    formHeading.textContent = `Editando: ${property.title}`;
    formHelp.textContent = "Cambiá lo que haga falta y tocá \"Actualizar propiedad\" para guardar.";
    submitBtn.textContent = "Actualizar propiedad";
    cancelEditBtn.style.display = "inline-block";
    resultBox.style.display = "none";
    switchTab("nueva");
  }

  function stopEdit() {
    editingId = null;
    form.reset();
    photoManager.reset();
    formHeading.textContent = "Nueva propiedad";
    formHelp.textContent = "Completá estos datos para publicar un aviso nuevo. Los campos con * son obligatorios, el resto podés dejarlos en blanco si no aplican.";
    submitBtn.textContent = "Guardar propiedad";
    cancelEditBtn.style.display = "none";
  }

  cancelEditBtn.addEventListener("click", stopEdit);

  /* --------------------------- Mis propiedades ------------------------ */
  async function loadPropertiesList() {
    listBox.innerHTML = `<p style="color:var(--color-text-light);">Cargando…</p>`;
    const { data, error } = await supabaseClient.from("properties").select("*").order("created_at", { ascending: false });
    if (error) {
      listBox.innerHTML = `<p style="color:var(--color-danger);">No se pudo cargar la lista: ${error.message}</p>`;
      return;
    }
    if (!data || data.length === 0) {
      listBox.innerHTML = `<p style="color:var(--color-text-light);">Todavía no hay propiedades cargadas. Andá a la pestaña "Nueva propiedad" para cargar la primera.</p>`;
      return;
    }
    listBox.innerHTML = data
      .map(
        (p) => `
      <div class="admin-list-row">
        <div class="admin-list-thumb">
          ${p.images && p.images[0] ? `<img src="${p.images[0]}" alt="">` : ""}
        </div>
        <div class="admin-list-info">
          <span class="admin-list-title">${p.title}</span>
          ${p.active === false ? `<span class="admin-status-badge">Inactiva</span>` : ""}
          <span class="admin-list-meta" style="display:block;">${operationLabel(p.operation)} · ${typeLabel(p.type)} · ${p.currency} ${p.price.toLocaleString("es-AR")}</span>
        </div>
        <div class="admin-list-actions">
          <button type="button" class="btn btn-sm btn-dark" data-edit-id="${p.id}">Editar</button>
          <button type="button" class="btn btn-sm ${p.active === false ? "btn-primary" : ""}" data-toggle-active-id="${p.id}" data-current-active="${p.active !== false}">${p.active === false ? "Activar" : "Desactivar"}</button>
          <button type="button" class="admin-delete-link" data-delete-id="${p.id}">Eliminar definitivamente</button>
        </div>
      </div>`
      )
      .join("");

    listBox.querySelectorAll("[data-edit-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const property = data.find((p) => p.id === parseInt(btn.dataset.editId, 10));
        if (property) startEdit(property);
      });
    });

    listBox.querySelectorAll("[data-toggle-active-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = parseInt(btn.dataset.toggleActiveId, 10);
        const nextActive = btn.dataset.currentActive !== "true";
        btn.disabled = true;
        const { error: toggleError } = await supabaseClient.from("properties").update({ active: nextActive }).eq("id", id);
        btn.disabled = false;
        if (toggleError) {
          alert("No se pudo guardar: " + toggleError.message);
          return;
        }
        loadPropertiesList();
        loadFeaturedList();
      });
    });

    listBox.querySelectorAll("[data-delete-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = parseInt(btn.dataset.deleteId, 10);
        if (!confirm("Esto borra la propiedad y sus datos para siempre, no se puede deshacer.\n\n¿Seguro? Si es un alquiler que puede volver a ocuparse, mejor usá \"Desactivar\".")) return;
        const { error: deleteError } = await supabaseClient.from("properties").delete().eq("id", id);
        if (deleteError) {
          alert("No se pudo eliminar: " + deleteError.message);
          return;
        }
        if (editingId === id) stopEdit();
        loadPropertiesList();
        loadFeaturedList();
      });
    });
  }

  /* ------------------------------ Destacadas -------------------------- */
  async function loadFeaturedList() {
    featuredBox.innerHTML = `<p style="color:var(--color-text-light);">Cargando…</p>`;
    const { data, error } = await supabaseClient
      .from("properties")
      .select("*")
      .eq("active", true)
      .order("created_at", { ascending: false });
    if (error) {
      featuredBox.innerHTML = `<p style="color:var(--color-danger);">No se pudo cargar la lista: ${error.message}</p>`;
      return;
    }
    if (!data || data.length === 0) {
      featuredBox.innerHTML = `<p style="color:var(--color-text-light);">No hay propiedades activas para destacar. Activá alguna desde "Mis propiedades".</p>`;
      return;
    }
    featuredBox.innerHTML = data
      .map(
        (p) => `
      <div class="admin-list-row">
        <div class="admin-list-thumb">
          ${p.images && p.images[0] ? `<img src="${p.images[0]}" alt="">` : ""}
        </div>
        <div class="admin-list-info">
          <span class="admin-list-title">${p.title}</span>
          <span class="admin-list-meta">${operationLabel(p.operation)} · ${typeLabel(p.type)}</span>
        </div>
        <label class="admin-featured-toggle">
          <input type="checkbox" data-featured-id="${p.id}" ${p.featured ? "checked" : ""}>
          Destacada
        </label>
      </div>`
      )
      .join("");

    featuredBox.querySelectorAll("[data-featured-id]").forEach((checkbox) => {
      checkbox.addEventListener("change", async () => {
        const id = parseInt(checkbox.dataset.featuredId, 10);
        checkbox.disabled = true;
        const { error: updateError } = await supabaseClient.from("properties").update({ featured: checkbox.checked }).eq("id", id);
        checkbox.disabled = false;
        if (updateError) {
          alert("No se pudo guardar: " + updateError.message);
          checkbox.checked = !checkbox.checked;
        }
      });
    });
  }

  /* --------------------------- Mensajes de contacto -------------------- */
  async function loadMessages() {
    messagesBox.innerHTML = `<p style="color:var(--color-text-light);">Cargando…</p>`;
    const { data, error } = await supabaseClient.from("contact_messages").select("*").order("created_at", { ascending: false });
    if (error) {
      messagesBox.innerHTML = `<p style="color:var(--color-danger);">No se pudo cargar los mensajes: ${error.message}</p>`;
      return;
    }
    if (!data || data.length === 0) {
      messagesBox.innerHTML = `<p style="color:var(--color-text-light);">Todavía no llegó ninguna consulta por el formulario.</p>`;
      return;
    }
    messagesBox.innerHTML = data
      .map((m) => {
        const date = new Date(m.created_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
        const contactParts = [m.phone, m.email].filter(Boolean).join(" · ");
        return `
      <div class="admin-message-card">
        <div class="admin-message-header">
          <div>
            <span class="admin-message-who">${m.name}</span>
            ${contactParts ? `<span class="admin-message-contact"> · ${contactParts}</span>` : ""}
            ${m.reason ? `<span class="admin-message-contact"> · Motivo: ${m.reason}</span>` : ""}
          </div>
          <span class="admin-message-date">${date}</span>
        </div>
        <p>${m.message || ""}</p>
      </div>`;
      })
      .join("");
  }

  /* -------------------------- Subida de fotos -------------------------- */
  async function uploadNewImages(images) {
    const folder = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const urls = [];
    for (const img of images) {
      if (!img.url.startsWith("blob:")) {
        urls.push(img.url);
        continue;
      }
      const blob = await fetch(img.url).then((r) => r.blob());
      const ext = (img.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `${folder}/${urls.length + 1}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabaseClient.storage.from(STORAGE_BUCKET).upload(path, blob, {
        contentType: blob.type || "image/jpeg",
      });
      if (error) throw error;
      const { data } = supabaseClient.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      urls.push(data.publicUrl);
    }
    return urls;
  }

  /* ------------------------------ Guardar ------------------------------ */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const data = new FormData(form);
    const title = (data.get("title") || "").trim();
    const currency = data.get("currency") === "ARS" ? "ARS" : "USD";
    const price = parseFloat(data.get("price")) || 0;
    const amenities = (data.get("amenities") || "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);

    submitBtn.disabled = true;
    submitBtn.textContent = editingId ? "Actualizando…" : "Guardando…";

    try {
      const images = await uploadNewImages(photoManager.getImages());

      const payload = {
        title,
        operation: data.get("operation"),
        type: data.get("type"),
        zone: data.get("zone"),
        address: (data.get("address") || "").trim(),
        currency,
        price,
        bedrooms: parseInt(data.get("bedrooms"), 10) || 0,
        bathrooms: parseInt(data.get("bathrooms"), 10) || 0,
        area: parseFloat(data.get("area")) || 0,
        description: (data.get("description") || "").trim(),
        amenities,
        images,
      };

      const { error } = editingId
        ? await supabaseClient.from("properties").update(payload).eq("id", editingId)
        : await supabaseClient.from("properties").insert(payload);

      if (error) throw error;

      const wasEditing = !!editingId;
      resultBox.style.display = "block";
      resultBox.innerHTML = `
        <div class="admin-card" style="border-color: var(--color-red); background: var(--color-paper-alt);">
          <h2>Propiedad ${wasEditing ? "actualizada" : "publicada"}</h2>
          <p><strong>${title}</strong> ya está guardada y visible en el sitio.</p>
        </div>`;
      resultBox.scrollIntoView({ behavior: "smooth", block: "start" });

      stopEdit();
      loadPropertiesList();
      loadFeaturedList();
    } catch (err) {
      resultBox.style.display = "block";
      resultBox.innerHTML = `
        <div class="admin-card" style="border-color: var(--color-danger);">
          <h2>No se pudo guardar</h2>
          <p>${err.message || err}</p>
        </div>`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = editingId ? "Actualizar propiedad" : "Guardar propiedad";
    }
  });
});
