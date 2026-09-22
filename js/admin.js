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
  const loginLockout = document.getElementById("admin-login-lockout");
  const panel = document.getElementById("admin-panel");
  const logoutBtn = document.getElementById("admin-logout");

  const guiaCard = document.getElementById("admin-guia-primeros-pasos");
  const guiaCerrarBtn = document.getElementById("admin-guia-cerrar");
  const guiaVerBtn = document.getElementById("admin-ver-guia");

  const forgotLink = document.getElementById("admin-forgot-link");
  const recoverForm = document.getElementById("admin-recover-form");
  const recoverMsg = document.getElementById("admin-recover-msg");
  const recoverCancel = document.getElementById("admin-recover-cancel");
  const resetWrap = document.getElementById("admin-reset-wrap");
  const resetForm = document.getElementById("admin-reset-form");
  const resetError = document.getElementById("admin-reset-error");

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

    if (tabName === "hoy") AdminHoy.loadResumen();
    if (tabName === "inmuebles") AdminInmuebles.loadList();
    if (tabName === "destacadas") AdminInmuebles.loadFeatured();
    if (tabName === "personas") AdminPersonas.loadList();
    if (tabName === "contratos") AdminContratos.loadList();
    if (tabName === "indices") AdminContratos.loadIndices();
    if (tabName === "mensajes") loadMessages();
    if (tabName === "testimonios") AdminTestimonios.loadList();
    if (tabName === "cobranzas") { AdminCobranzas.loadCuotas(); AdminCobranzas.loadHistorial(); }
    if (tabName === "gastos") AdminGastos.loadList();
    if (tabName === "liquidaciones") { AdminLiquidaciones.poblarPersonas(); AdminLiquidaciones.loadList(); AdminLiquidaciones.loadPendientes(); }
    if (tabName === "caja") { AdminCaja.loadMovimientos(); AdminCaja.loadSaldosHoy(); }
    if (tabName === "ventas") AdminVentas.loadList();
    if (tabName === "agenda") AdminAgenda.loadList();
    if (tabName === "configuracion") { AdminConfiguracion.loadConfig(); loadCuentaUsuario(); }
    if (tabName === "contenido") AdminContenido.loadContenido();
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
    resetWrap.style.display = "none";
    panel.style.display = "block";
    AdminHoy.loadResumen();
    AdminPersonas.loadList();
    AdminInmuebles.loadList();
    AdminInmuebles.loadFeatured();
    loadMessages();

    let yaVioGuia = false;
    try { yaVioGuia = localStorage.getItem("admin_guia_vista") === "1"; } catch {}
    guiaCard.style.display = yaVioGuia ? "none" : "block";
  }

  guiaCerrarBtn.addEventListener("click", () => {
    guiaCard.style.display = "none";
    try { localStorage.setItem("admin_guia_vista", "1"); } catch {}
  });

  guiaVerBtn.addEventListener("click", () => {
    switchTab("hoy");
    guiaCard.style.display = "block";
    guiaCard.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  function showLoggedOut() {
    loginWrap.style.display = "block";
    resetWrap.style.display = "none";
    panel.style.display = "none";
    loginForm.style.display = "block";
    forgotLink.style.display = "inline-block";
    recoverForm.style.display = "none";
    recoverCancel.style.display = "none";
  }

  function showResetPassword() {
    loginWrap.style.display = "none";
    panel.style.display = "none";
    resetWrap.style.display = "block";
  }

  supabaseClient.auth.getSession().then(({ data }) => {
    if (data.session) showLoggedIn();
    else showLoggedOut();
  });

  supabaseClient.auth.onAuthStateChange((event, session) => {
    // Al tocar el link del mail de recuperación, Supabase abre esta misma
    // página con una sesión temporal de tipo "recovery" — no es un login
    // normal, así que en vez de mandarla al panel le mostramos el
    // formulario para elegir la contraseña nueva.
    if (event === "PASSWORD_RECOVERY") {
      showResetPassword();
      return;
    }
    if (session) showLoggedIn();
    else showLoggedOut();
  });

  /* ------------------- Límite de intentos de login ------------------- */
  // Protección del lado del cliente (además del límite que ya aplica
  // Supabase Auth del lado del servidor): frena reintentos automáticos
  // desde el mismo navegador sin tener que tocar nada en el backend.
  const LOGIN_LOCK_KEY = "admin_login_lock";
  const LOGIN_MAX_ATTEMPTS = 5;
  const LOGIN_LOCK_MINUTES = 5;
  let lockoutInterval;

  function leerEstadoBloqueo() {
    try {
      const st = JSON.parse(localStorage.getItem(LOGIN_LOCK_KEY));
      if (st && typeof st.attempts === "number" && typeof st.lockedUntil === "number") return st;
    } catch {}
    return { attempts: 0, lockedUntil: 0 };
  }

  function guardarEstadoBloqueo(st) {
    try { localStorage.setItem(LOGIN_LOCK_KEY, JSON.stringify(st)); } catch {}
  }

  function actualizarBloqueoUI() {
    clearInterval(lockoutInterval);
    const submitBtn = loginForm.querySelector("button[type=submit]");

    const mostrarRestante = () => {
      const ms = leerEstadoBloqueo().lockedUntil - Date.now();
      if (ms <= 0) {
        loginLockout.style.display = "none";
        submitBtn.disabled = false;
        clearInterval(lockoutInterval);
        return;
      }
      const min = Math.floor(ms / 60000);
      const seg = Math.ceil((ms % 60000) / 1000);
      loginLockout.textContent = `Demasiados intentos fallidos. Probá de nuevo en ${min > 0 ? `${min} min ` : ""}${seg}s.`;
      loginLockout.style.display = "block";
      submitBtn.disabled = true;
    };

    mostrarRestante();
    if (leerEstadoBloqueo().lockedUntil > Date.now()) {
      lockoutInterval = setInterval(mostrarRestante, 1000);
    }
  }

  function registrarIntentoFallido() {
    const st = leerEstadoBloqueo();
    const attempts = st.attempts + 1;
    if (attempts >= LOGIN_MAX_ATTEMPTS) {
      guardarEstadoBloqueo({ attempts: 0, lockedUntil: Date.now() + LOGIN_LOCK_MINUTES * 60000 });
    } else {
      guardarEstadoBloqueo({ attempts, lockedUntil: st.lockedUntil });
    }
    actualizarBloqueoUI();
  }

  function limpiarBloqueo() {
    guardarEstadoBloqueo({ attempts: 0, lockedUntil: 0 });
    actualizarBloqueoUI();
  }

  actualizarBloqueoUI();

  // El login pide "usuario" (elegido desde Configuración → Mi cuenta), pero
  // Supabase Auth sigue siendo por email por dentro. Si lo que escribió
  // parece un email (tiene "@"), se usa tal cual — así el primer ingreso,
  // antes de elegir un usuario, sigue funcionando con el email de siempre.
  async function resolverEmailDeLogin(valor) {
    const texto = (valor || "").trim();
    if (texto.includes("@")) return texto;
    const { data, error } = await supabaseClient.rpc("usuario_a_email", { p_usuario: texto });
    if (error || !data) return null;
    return data;
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.style.display = "none";
    const data = new FormData(loginForm);

    // Trampa para bots: un visitante real nunca completa este campo (está
    // oculto por CSS). Si viene con algo, se descarta sin gastar un intento
    // de verdad contra Supabase Auth.
    if (data.get("website")) return;

    if (leerEstadoBloqueo().lockedUntil > Date.now()) {
      actualizarBloqueoUI();
      return;
    }

    const email = await resolverEmailDeLogin(data.get("email"));
    if (!email) {
      registrarIntentoFallido();
      loginError.textContent = "No se pudo ingresar: usuario o contraseña incorrectos.";
      loginError.style.display = "block";
      return;
    }

    const { error } = await supabaseClient.auth.signInWithPassword({
      email,
      password: data.get("password"),
    });
    if (error) {
      registrarIntentoFallido();
      loginError.textContent = "No se pudo ingresar: usuario o contraseña incorrectos.";
      loginError.style.display = "block";
    } else {
      limpiarBloqueo();
      loginForm.reset();
    }
  });

  logoutBtn.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
  });

  /* ------------------------ Recuperar contraseña ---------------------- */
  forgotLink.addEventListener("click", () => {
    loginForm.style.display = "none";
    forgotLink.style.display = "none";
    loginError.style.display = "none";
    recoverMsg.style.display = "none";
    recoverForm.style.display = "block";
    recoverCancel.style.display = "inline-block";
  });

  recoverCancel.addEventListener("click", () => {
    recoverForm.style.display = "none";
    recoverCancel.style.display = "none";
    loginForm.style.display = "block";
    forgotLink.style.display = "inline-block";
  });

  recoverForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(recoverForm);
    const submitBtn = recoverForm.querySelector("button[type=submit]");
    submitBtn.disabled = true;

    const email = await resolverEmailDeLogin(data.get("email"));
    if (email) {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname,
      });
      if (error) console.error("resetPasswordForEmail:", error);
    }

    submitBtn.disabled = false;
    // Mismo mensaje haya error o no: no delatar si ese usuario tiene cuenta acá.
    recoverMsg.textContent = "Si ese usuario tiene una cuenta, te llega un link por email para elegir una contraseña nueva.";
    recoverMsg.style.display = "block";
    recoverForm.reset();
  });

  /* ------------------------ Elegir contraseña nueva -------------------- */
  resetForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    resetError.style.display = "none";
    const data = new FormData(resetForm);
    const password = data.get("password");
    const passwordConfirm = data.get("passwordConfirm");

    if (password !== passwordConfirm) {
      resetError.textContent = "Las dos contraseñas no coinciden.";
      resetError.style.display = "block";
      return;
    }

    const { error } = await supabaseClient.auth.updateUser({ password });
    if (error) {
      resetError.textContent = "No se pudo guardar la contraseña: " + error.message;
      resetError.style.display = "block";
      return;
    }

    resetForm.reset();
    showLoggedIn();
  });

  /* ----------------------------- Mi cuenta ------------------------------ */
  const cuentaUsuarioForm = document.getElementById("cuenta-usuario-form");
  const cuentaUsuarioInput = document.getElementById("cuenta-usuario");
  const cuentaUsuarioError = document.getElementById("cuenta-usuario-error");
  const cuentaUsuarioGuardado = document.getElementById("cuenta-usuario-guardado");
  const cuentaPasswordForm = document.getElementById("cuenta-password-form");
  const cuentaPasswordError = document.getElementById("cuenta-password-error");
  const cuentaPasswordGuardado = document.getElementById("cuenta-password-guardado");

  async function loadCuentaUsuario() {
    cuentaUsuarioError.style.display = "none";
    const { data: userData } = await supabaseClient.auth.getUser();
    if (!userData || !userData.user) return;

    const { data } = await supabaseClient.from("admin_usuarios").select("usuario").eq("user_id", userData.user.id).maybeSingle();
    cuentaUsuarioInput.value = data ? data.usuario : "";
  }

  cuentaUsuarioForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    cuentaUsuarioError.style.display = "none";
    const usuario = cuentaUsuarioInput.value.trim();

    if (usuario.includes("@")) {
      cuentaUsuarioError.textContent = "El usuario no puede tener un \"@\" (para no confundirlo con un email).";
      cuentaUsuarioError.style.display = "block";
      return;
    }

    const { data: userData } = await supabaseClient.auth.getUser();
    if (!userData || !userData.user) return;

    const submitBtn = cuentaUsuarioForm.querySelector("button[type=submit]");
    submitBtn.disabled = true;

    const { error } = await supabaseClient
      .from("admin_usuarios")
      .upsert({ usuario, user_id: userData.user.id }, { onConflict: "user_id" });

    submitBtn.disabled = false;

    if (error) {
      cuentaUsuarioError.textContent = error.code === "23505"
        ? "Ese usuario ya lo está usando otra cuenta — probá con otro."
        : "No se pudo guardar: " + error.message;
      cuentaUsuarioError.style.display = "block";
      return;
    }

    cuentaUsuarioGuardado.style.display = "inline";
    setTimeout(() => { cuentaUsuarioGuardado.style.display = "none"; }, 3000);
  });

  cuentaPasswordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    cuentaPasswordError.style.display = "none";
    const data = new FormData(cuentaPasswordForm);
    const password = data.get("password");
    const passwordConfirm = data.get("passwordConfirm");

    if (password !== passwordConfirm) {
      cuentaPasswordError.textContent = "Las dos contraseñas no coinciden.";
      cuentaPasswordError.style.display = "block";
      return;
    }

    const submitBtn = cuentaPasswordForm.querySelector("button[type=submit]");
    submitBtn.disabled = true;

    const { error } = await supabaseClient.auth.updateUser({ password });

    submitBtn.disabled = false;

    if (error) {
      cuentaPasswordError.textContent = "No se pudo cambiar la contraseña: " + error.message;
      cuentaPasswordError.style.display = "block";
      return;
    }

    cuentaPasswordForm.reset();
    cuentaPasswordGuardado.style.display = "inline";
    setTimeout(() => { cuentaPasswordGuardado.style.display = "none"; }, 3000);
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
            <span class="admin-message-who">${V.escaparHtml(m.name)}</span>
            ${contactParts ? `<span class="admin-message-contact"> · ${V.escaparHtml(contactParts)}</span>` : ""}
            ${m.reason ? `<span class="admin-message-contact"> · Motivo: ${V.escaparHtml(m.reason)}</span>` : ""}
          </div>
          <span class="admin-message-date">${date}</span>
        </div>
        <p>${V.escaparHtml(m.message || "")}</p>
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
  AdminCaja.init();
  AdminVentas.init();
  AdminAgenda.init();
  AdminInformes.init();
  AdminConfiguracion.init();
  AdminContenido.init();
  AdminTestimonios.init();
  AdminHoy.init();
});
