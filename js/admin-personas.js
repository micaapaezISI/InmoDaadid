/* =====================================================================
   PATRICIA DAADIN — Panel admin: Personas
   ---------------------------------------------------------------------
   Portado de src/routes/personas.js de InmoGestion (validación de
   documento/teléfono/email en js/validar.js). Por ahora las personas
   solo se usan como propietarias de inmuebles — cuando exista el módulo
   de Contratos, la misma ficha sirve para inquilinos y garantes.
   ===================================================================== */

const AdminPersonas = (() => {
  let cache = [];
  let editingId = null;

  const modal = document.getElementById("persona-modal");
  const form = document.getElementById("persona-form");
  const heading = document.getElementById("persona-modal-heading");
  const errorBox = document.getElementById("persona-form-error");
  const listBox = document.getElementById("admin-personas-list");
  const buscarInput = document.getElementById("persona-buscar");
  const nuevaBtn = document.getElementById("persona-nueva-btn");
  const cancelarBtn = document.getElementById("persona-cancelar");

  function abrirModal(persona) {
    editingId = persona ? persona.id : null;
    form.reset();
    errorBox.style.display = "none";
    if (persona) {
      heading.textContent = "Editando: " + persona.nombre;
      Object.keys(persona).forEach((campo) => {
        if (form.elements[campo]) form.elements[campo].value = persona[campo] ?? "";
      });
    } else {
      heading.textContent = "＋ Nueva persona";
    }
    modal.style.display = "flex";
  }

  function cerrarModal() {
    modal.style.display = "none";
    editingId = null;
  }

  function normalizar(data) {
    const errores = [];
    const nombre = V.texto(data.get("nombre"));
    if (!nombre) errores.push("Escribí el nombre o razón social.");

    const documento_tipo = V.unoDe(data.get("documento_tipo"), ["DNI", "CUIT", "CUIL", "LE", "LC", "PAS"], "DNI");
    const documento = V.texto(data.get("documento"), { max: 20 });
    if (documento && !V.documentoValido(documento, documento_tipo)) {
      errores.push(V.mensajeDocumentoInvalido(documento_tipo));
    }

    const telefono = V.texto(data.get("telefono"), { max: 40 });
    if (telefono && !V.telefonoValido(telefono)) errores.push("Ese teléfono no parece válido: tiene que tener entre 6 y 15 números.");

    const email = V.texto(data.get("email"));
    if (email && !V.emailValido(email)) errores.push("Ese email no parece válido — revisá que tenga la arroba (@) y el dominio completo.");

    if (errores.length) throw new Error(errores.join(" "));

    return {
      tipo_persona: V.unoDe(data.get("tipo_persona"), ["fisica", "juridica"], "fisica"),
      nombre,
      documento_tipo,
      documento,
      telefono,
      email,
      domicilio: V.texto(data.get("domicilio")),
      cbu: V.texto(data.get("cbu"), { max: 30 }),
      banco: V.texto(data.get("banco")),
      condicion_iva: V.unoDe(data.get("condicion_iva"),
        ["responsable_inscripto", "monotributista", "exento", "consumidor_final", "no_categorizado"], "consumidor_final"),
      notas: V.texto(data.get("notas"), { max: 4000 }),
    };
  }

  async function loadList() {
    listBox.innerHTML = `<p style="color:var(--color-text-light); padding-top:14px;">Cargando…</p>`;
    const { data, error } = await supabaseClient.from("personas").select("*").eq("activo", true).order("nombre");
    if (error) {
      listBox.innerHTML = `<p style="color:var(--color-danger);">No se pudo cargar la lista: ${error.message}</p>`;
      return;
    }
    cache = data || [];
    renderList(cache);
  }

  function renderList(lista) {
    if (!lista.length) {
      listBox.innerHTML = `<p style="color:var(--color-text-light); padding-top:14px;">Todavía no cargaste ninguna persona. Usá "＋ Nueva persona" para empezar.</p>`;
      return;
    }
    listBox.innerHTML = lista
      .map(
        (p) => `
      <div class="admin-list-row">
        <div class="admin-list-info">
          <span class="admin-list-title">${p.nombre}</span>
          <span class="admin-list-meta" style="display:block;">${p.documento_tipo || ""} ${p.documento || ""} ${p.telefono ? " · " + p.telefono : ""}${p.email ? " · " + p.email : ""}</span>
        </div>
        <div class="admin-list-actions">
          <button type="button" class="btn btn-sm btn-dark" data-editar-persona="${p.id}">Editar</button>
          <button type="button" class="admin-delete-link" data-borrar-persona="${p.id}">Dar de baja</button>
        </div>
      </div>`
      )
      .join("");

    listBox.querySelectorAll("[data-editar-persona]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const persona = cache.find((p) => p.id === parseInt(btn.dataset.editarPersona, 10));
        if (persona) abrirModal(persona);
      });
    });

    listBox.querySelectorAll("[data-borrar-persona]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = parseInt(btn.dataset.borrarPersona, 10);
        if (!confirm("¿Dar de baja a esta persona? No se borra: queda inactiva y se puede reactivar más adelante si hace falta.")) return;
        const { error } = await supabaseClient.from("personas").update({ activo: false }).eq("id", id);
        if (error) return alert("No se pudo dar de baja: " + error.message);
        loadList();
      });
    });
  }

  nuevaBtn.addEventListener("click", () => abrirModal(null));
  cancelarBtn.addEventListener("click", cerrarModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) cerrarModal(); });

  buscarInput.addEventListener("input", () => {
    const q = buscarInput.value.trim().toLowerCase();
    if (!q) return renderList(cache);
    renderList(cache.filter((p) =>
      p.nombre.toLowerCase().includes(q) || (p.documento || "").toLowerCase().includes(q)
    ));
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.style.display = "none";
    const submitBtn = form.querySelector("button[type=submit]");
    try {
      const datos = normalizar(new FormData(form));
      submitBtn.disabled = true;
      const { error } = editingId
        ? await supabaseClient.from("personas").update(datos).eq("id", editingId)
        : await supabaseClient.from("personas").insert(datos);
      if (error) throw error;
      cerrarModal();
      loadList();
    } catch (err) {
      errorBox.textContent = err.message || String(err);
      errorBox.style.display = "block";
    } finally {
      submitBtn.disabled = false;
    }
  });

  return {
    init() {}, // los listeners ya quedan armados arriba al cargar el script
    loadList,
    getAll: () => cache,
    abrirModal,
  };
})();
