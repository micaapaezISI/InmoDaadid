/* =====================================================================
   PATRICIA DAADIN — Panel admin: sesión, navegación y mensajes
   ---------------------------------------------------------------------
   La lógica de Inmuebles vive en js/admin-inmuebles.js y la de Personas
   en js/admin-personas.js — este archivo solo maneja login/logout, el
   cambio de pestaña de la barra lateral y los mensajes de contacto.
   ===================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  const pmRoot = document.querySelector("[data-pm-root]");
  if (!pmRoot) return;

  const photoManager = createPhotoManager(pmRoot);

  const loginWrap = document.getElementById("admin-login-wrap");
  const loginForm = document.getElementById("admin-login-form");
  const loginError = document.getElementById("admin-login-error");
  const panel = document.getElementById("admin-panel");
  const logoutBtn = document.getElementById("admin-logout");

  const tabButtons = document.querySelectorAll(".admin-sidebar-link[data-tab]");
  const tabPanels = document.querySelectorAll(".admin-tab-panel");
  const messagesBox = document.getElementById("admin-messages-list");

  /* ---------------------------- Pestañas ---------------------------- */
  function switchTab(tabName) {
    tabButtons.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.tab === tabName));
    tabPanels.forEach((panelEl) => {
      panelEl.style.display = panelEl.id === `tab-panel-${tabName}` ? "block" : "none";
    });
    window.scrollTo({ top: panel.offsetTop - 20, behavior: "smooth" });

    if (tabName === "inmuebles") AdminInmuebles.loadList();
    if (tabName === "destacadas") AdminInmuebles.loadFeatured();
    if (tabName === "personas") AdminPersonas.loadList();
    if (tabName === "contratos") AdminContratos.loadList();
    if (tabName === "indices") AdminContratos.loadIndices();
    if (tabName === "mensajes") loadMessages();
    if (tabName === "cobranzas") { AdminCobranzas.loadCuotas(); AdminCobranzas.loadHistorial(); }
    if (tabName === "gastos") AdminGastos.loadList();
    if (tabName === "liquidaciones") AdminLiquidaciones.loadList();
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      // "＋ Nuevo inmueble"/"＋ Nuevo contrato" siempre arrancan en blanco,
      // aunque se haya llegado a este botón en medio de estar editando
      // otro registro. startEdit() cambia de pestaña por su cuenta (ver
      // admin-inmuebles.js/admin-contratos.js) sin pasar por este botón,
      // así que no le pisa los datos que acaba de cargar.
      if (btn.dataset.tab === "nueva") AdminInmuebles.prepararNuevo();
      if (btn.dataset.tab === "nuevo-contrato") AdminContratos.prepararNuevo();
      switchTab(btn.dataset.tab);
    });
  });

  window.adminSwitchTab = switchTab;

  /* ------------------------------ Sesión ----------------------------- */
  function showLoggedIn() {
    loginWrap.style.display = "none";
    panel.style.display = "block";
    AdminPersonas.loadList();
    AdminInmuebles.loadList();
    AdminInmuebles.loadFeatured();
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

  // Inicializa los módulos de Inmuebles, Personas y Contratos (les pasa el
  // photoManager y las referencias que necesitan) — ver
  // admin-inmuebles.js/admin-personas.js/admin-contratos.js.
  AdminInmuebles.init({ photoManager, onSaved: () => { AdminInmuebles.loadList(); AdminInmuebles.loadFeatured(); switchTab("inmuebles"); } });
  AdminPersonas.init();
  AdminContratos.init({ onSaved: () => switchTab("contratos") });
  AdminCobranzas.init();
  AdminGastos.init();
  AdminLiquidaciones.init();
});
