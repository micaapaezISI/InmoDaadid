/* =====================================================================
   PATRICIA DAADIN — Panel admin: Inmuebles
   ---------------------------------------------------------------------
   Portado de src/routes/propiedades.js de InmoGestion a Supabase:
   - CRUD simple (alta/edición/baja lógica) via supabase-js directo,
     protegido por RLS ("authenticated" = Patricia logueada).
   - Guardar los propietarios de un inmueble toca dos tablas a la vez
     (borra y reinserta propiedad_propietario) — eso vive en la función
     de Postgres reemplazar_propietarios() (ver supabase/migrations),
     equivalente a un db.transaction() sin tener un servidor propio.
   - Las fotos reutilizan el mismo bucket y el mismo widget
     (photo-manager.js) que ya usaba este sitio, ahora contra la tabla
     propiedad_foto en vez del array properties.images.
   ===================================================================== */

const AdminInmuebles = (() => {
  const STORAGE_BUCKET = "property-photos";

  let photoManager = null;
  let onSaved = () => {};
  let editingId = null;
  let cacheInmuebles = [];

  const form = document.getElementById("admin-property-form");
  const resultBox = document.getElementById("admin-result");
  const listBox = document.getElementById("admin-properties-list");
  const featuredBox = document.getElementById("admin-featured-list");
  const submitBtn = document.getElementById("admin-submit-btn");
  const cancelEditBtn = document.getElementById("admin-cancel-edit");
  const formHeading = document.getElementById("admin-form-heading");
  const formHelp = document.getElementById("admin-form-help");
  const propietariosList = document.getElementById("p-propietarios-list");
  const propietarioAgregarBtn = document.getElementById("p-propietario-agregar");
  const amenitiesHidden = document.getElementById("p-amenities");
  const amenitiesOtras = document.getElementById("p-amenities-otras");
  const previewCardBox = document.getElementById("admin-preview-card");
  const previewDetailBox = document.getElementById("admin-preview-detail");

  /* ----------------------------- Características ----------------------- */

  function leerAmenitiesDelForm() {
    const marcadas = Array.from(document.querySelectorAll("[data-amenity-check]:checked")).map((cb) => cb.value);
    const otras = (amenitiesOtras.value || "").split(",").map((a) => a.trim()).filter(Boolean);
    return [...marcadas, ...otras];
  }

  function sincronizarAmenitiesHidden() {
    amenitiesHidden.value = leerAmenitiesDelForm().join(", ");
  }

  function sincronizarAmenitiesUI(lista) {
    const checks = Array.from(document.querySelectorAll("[data-amenity-check]"));
    const restantes = [];
    (lista || []).forEach((item) => {
      const match = checks.find((cb) => cb.value.toLowerCase() === String(item).trim().toLowerCase());
      if (match) match.checked = true;
      else restantes.push(item);
    });
    amenitiesOtras.value = restantes.join(", ");
    sincronizarAmenitiesHidden();
  }

  /* ------------------------ Operación y precios ------------------------ */

  // Qué precios pide cada operación: "ambas" (misma propiedad en venta y
  // en alquiler) necesita los dos; "temporal" usa el precio de alquiler
  // (por noche).
  function llevaVenta(operation) {
    return operation === "venta" || operation === "ambas";
  }
  function llevaAlquiler(operation) {
    return operation === "alquiler" || operation === "temporal" || operation === "ambas";
  }

  // Muestra solo los campos de precio que corresponden, y solo esos quedan
  // obligatorios (un campo oculto con "required" bloquearía el guardado).
  function sincronizarCamposPrecio() {
    const operation = form.elements.operation.value;
    const venta = llevaVenta(operation);
    const alquiler = llevaAlquiler(operation);
    form.querySelectorAll("[data-precio-venta]").forEach((el) => (el.style.display = venta ? "" : "none"));
    form.querySelectorAll("[data-precio-alquiler]").forEach((el) => (el.style.display = alquiler ? "" : "none"));
    form.elements.price_venta.required = venta;
    form.elements.price_alquiler.required = alquiler;
    const label = form.querySelector("[data-precio-alquiler-label]");
    if (label) label.textContent = operation === "temporal" ? "Precio de alquiler temporario (por noche) *" : "Precio de alquiler (por mes) *";
  }

  // Barrios ya usados en otros inmuebles, sumados a las sugerencias del
  // campo "Barrio" (se puede escribir cualquiera, esto es solo ayuda).
  function sumarBarriosSugeridos(barrios) {
    const datalist = document.getElementById("p-zone-opciones");
    if (!datalist) return;
    const existentes = new Set(Array.from(datalist.options).map((o) => o.value.toLowerCase()));
    barrios.filter(Boolean).forEach((b) => {
      if (existentes.has(b.toLowerCase())) return;
      existentes.add(b.toLowerCase());
      const opt = document.createElement("option");
      opt.value = b;
      datalist.appendChild(opt);
    });
  }

  /* ------------------------------ Vista previa --------------------------- */

  function tituloAutomatico(tipo, zona, localidad) {
    return `${typeLabel(tipo)} en ${zona || localidad || "San Salvador de Jujuy"}`;
  }

  function leerVistaPreviaDelForm() {
    const fd = new FormData(form);
    const operation = fd.get("operation") || "venta";
    const type = fd.get("type") || "casa";
    const zone = (fd.get("zone") || "").trim();
    const localidad = (fd.get("localidad") || "").trim() || "San Salvador de Jujuy";
    const ocultarDireccion = fd.get("ocultar_direccion") === "on";
    const calle = fd.get("calle") || "";
    const numero = fd.get("numero") || "";
    const priceVenta = Dinero.aPesos(Dinero.aCentavos(fd.get("price_venta"))) || 0;
    const currencyVenta = fd.get("currency_venta") === "ARS" ? "ARS" : "USD";
    const priceAlquiler = Dinero.aPesos(Dinero.aCentavos(fd.get("price_alquiler"))) || 0;
    const currencyAlquiler = fd.get("currency_alquiler") === "USD" ? "USD" : "ARS";
    const esVenta = llevaVenta(operation);

    return {
      title: fd.get("titulo_publico") || tituloAutomatico(type, zone, localidad),
      operation,
      type,
      zone,
      address: ocultarDireccion ? zone || localidad : [calle, numero].filter(Boolean).join(" ") || zone || localidad,
      price: esVenta ? priceVenta : priceAlquiler,
      currency: esVenta ? currencyVenta : currencyAlquiler,
      priceVenta,
      currencyVenta,
      priceAlquiler,
      currencyAlquiler,
      bedrooms: parseInt(fd.get("bedrooms"), 10) || 0,
      bathrooms: parseInt(fd.get("bathrooms"), 10) || 0,
      area: fd.get("area") || "0",
      piso: fd.get("piso") || "",
      unidad: fd.get("departamento") || "",
      description: fd.get("description") || "",
      amenities: leerAmenitiesDelForm(),
      images: photoManager ? photoManager.getImages().map((i) => i.url) : [],
    };
  }

  function previewCardHTML(p) {
    const badgeClass = operationBadgeClass(p.operation);
    const media = p.images.length
      ? `<img src="${p.images[0]}" alt="">`
      : placeholderPhotoSVG(0, typeLabel(p.type));

    return `
      <article class="property-card">
        <div class="property-media">
          <span class="property-badge ${badgeClass}">${operationLabel(p.operation)}</span>
          ${media}
        </div>
        <div class="property-body">
          <div class="property-price">${formatPrice(p)}</div>
          <span class="property-title">${V.escaparHtml(p.title)}</span>
          <div class="property-location">${V.escaparHtml(p.address)}${p.piso ? ` · Piso ${V.escaparHtml(p.piso)}` : ""}${p.unidad ? ` "${V.escaparHtml(p.unidad)}"` : ""}</div>
          <div class="property-features">
            ${p.bedrooms ? `<span>${p.bedrooms} dorm.</span>` : ""}
            ${p.bathrooms ? `<span>${p.bathrooms} baño${p.bathrooms === 1 ? "" : "s"}</span>` : ""}
            <span>${p.area} m²</span>
          </div>
        </div>
      </article>`;
  }

  function previewDetailHTML(p) {
    return `
      <div class="admin-preview-detail-block">
        <h4>Descripción</h4>
        <p>${p.description ? V.escaparHtml(p.description) : "Sin descripción todavía…"}</p>
      </div>
      ${p.amenities.length ? `
      <div class="admin-preview-detail-block">
        <h4>Características</h4>
        <ul class="admin-preview-amenities">
          ${p.amenities.map((a) => `<li>✓ ${V.escaparHtml(a)}</li>`).join("")}
        </ul>
      </div>` : ""}`;
  }

  function actualizarVistaPrevia() {
    if (!previewCardBox || !previewDetailBox) return;
    const p = leerVistaPreviaDelForm();
    previewCardBox.innerHTML = previewCardHTML(p);
    previewDetailBox.innerHTML = previewDetailHTML(p);
  }

  function onFormChange() {
    sincronizarCamposPrecio();
    sincronizarAmenitiesHidden();
    actualizarVistaPrevia();
  }

  form.addEventListener("input", onFormChange);
  form.addEventListener("change", onFormChange);

  /* ------------------------- Propietarios (filas) --------------------- */

  function opcionesPersonas(seleccionadoId) {
    const personas = AdminPersonas.getAll();
    return (
      `<option value="">Elegir persona...</option>` +
      personas.map((p) => `<option value="${p.id}" ${String(p.id) === String(seleccionadoId) ? "selected" : ""}>${p.nombre}</option>`).join("")
    );
  }

  function addPropietarioRow(personaId, porcentaje) {
    const row = document.createElement("div");
    row.className = "admin-list-row";
    row.dataset.propietarioRow = "1";
    row.style.cssText = "padding:8px 0; gap:10px;";
    row.innerHTML = `
      <select data-propietario-persona style="flex:2; min-width:160px; padding:10px 12px; border:1.5px solid var(--color-border); border-radius:var(--radius-sm); background:var(--color-bg-alt);">
        ${opcionesPersonas(personaId)}
      </select>
      <input type="number" data-propietario-pct value="${porcentaje ?? 100}" min="0" max="100" step="0.01"
        style="width:90px; padding:10px; border:1.5px solid var(--color-border); border-radius:var(--radius-sm); background:var(--color-bg-alt);">
      <span style="font-size:0.85rem; color:var(--color-text-light);">%</span>
      <button type="button" class="btn btn-sm btn-dark" data-propietario-nueva>＋ Nueva</button>
      <button type="button" class="admin-delete-link" data-propietario-quitar>Quitar</button>
    `;
    row.querySelector("[data-propietario-quitar]").addEventListener("click", () => row.remove());
    row.querySelector("[data-propietario-nueva]").addEventListener("click", () => {
      // Al crear la persona en el modal, esta misma fila (y todas las demás
      // ya armadas) quedan con la lista de personas al día y la nueva
      // seleccionada acá — sin salir del formulario del inmueble.
      AdminPersonas.abrirModal(null, (nuevoId) => {
        document.querySelectorAll("[data-propietario-row] [data-propietario-persona]").forEach((select) => {
          const actual = select.value;
          select.innerHTML = opcionesPersonas(actual);
        });
        row.querySelector("[data-propietario-persona]").value = nuevoId;
      });
    });
    propietariosList.appendChild(row);
  }

  propietarioAgregarBtn.addEventListener("click", () => addPropietarioRow(null, propietariosList.children.length ? "" : 100));

  function leerPropietariosDelForm() {
    return Array.from(propietariosList.querySelectorAll("[data-propietario-row]"))
      .map((row) => ({
        persona_id: parseInt(row.querySelector("[data-propietario-persona]").value, 10),
        porcentaje: parseFloat(row.querySelector("[data-propietario-pct]").value),
      }))
      .filter((r) => r.persona_id);
  }

  /* --------------------------- Alta / edición ------------------------- */

  async function prepararNuevo() {
    editingId = null;
    form.reset();
    await AdminPersonas.loadList();
    propietariosList.innerHTML = "";
    addPropietarioRow(null, 100);
    amenitiesOtras.value = "";
    photoManager.reset();
    formHeading.textContent = "＋ Nuevo inmueble";
    formHelp.textContent = 'Completá estos datos para publicar un aviso nuevo. Los campos con * son obligatorios, el resto podés dejarlos en blanco si no aplican.';
    submitBtn.textContent = "Guardar inmueble";
    cancelEditBtn.style.display = "none";
    resultBox.style.display = "none";
    onFormChange();
  }

  async function startEdit(id) {
    const { data: propiedad, error } = await supabaseClient.from("propiedades").select("*").eq("id", id).single();
    if (error || !propiedad) return avisar("No se pudo abrir ese inmueble: " + (error ? error.message : ""), "error");

    const { data: propietarios } = await supabaseClient
      .from("propiedad_propietario")
      .select("persona_id, porcentaje")
      .eq("propiedad_id", id);

    const { data: fotos } = await supabaseClient
      .from("propiedad_foto")
      .select("*")
      .eq("propiedad_id", id)
      .order("orden");

    editingId = id;
    form.reset();
    await AdminPersonas.loadList();

    form.elements.operation.value = propiedad.operacion;
    form.elements.type.value = propiedad.tipo;
    form.elements.estado.value = propiedad.estado;
    form.elements.codigo.value = propiedad.codigo || "";
    form.elements.bedrooms.value = propiedad.dormitorios || 0;
    form.elements.bathrooms.value = propiedad.banos || 0;
    form.elements.cocheras.value = propiedad.cocheras || 0;
    form.elements.ambientes.value = propiedad.ambientes || "";
    form.elements.area.value = propiedad.superficie_total || "";
    form.elements.superficie_cubierta.value = propiedad.superficie_cubierta || "";
    form.elements.antiguedad.value = propiedad.antiguedad || "";
    form.elements.piso.value = propiedad.piso || "";
    form.elements.departamento.value = propiedad.departamento || "";
    form.elements.zone.value = propiedad.barrio || "";
    form.elements.localidad.value = propiedad.localidad || "San Salvador de Jujuy";
    form.elements.calle.value = propiedad.calle || "";
    form.elements.numero.value = propiedad.numero || "";
    form.elements.ocultar_direccion.checked = !!propiedad.ocultar_direccion;
    form.elements.currency_venta.value = propiedad.moneda_venta || "USD";
    form.elements.price_venta.value = propiedad.precio_venta != null ? Dinero.aPesos(propiedad.precio_venta) : "";
    form.elements.currency_alquiler.value = propiedad.moneda_alquiler || "ARS";
    form.elements.price_alquiler.value = propiedad.precio_alquiler != null ? Dinero.aPesos(propiedad.precio_alquiler) : "";
    form.elements.expensas.value = Dinero.aPesos(propiedad.expensas) || "";
    form.elements.comision_admin_pct.value = propiedad.comision_admin_pct || "";
    form.elements.publicar_web.checked = !!propiedad.publicar_web;
    form.elements.titulo_publico.value = propiedad.titulo_publico || "";
    form.elements.description.value = propiedad.descripcion || "";
    sincronizarAmenitiesUI(propiedad.amenities || []);
    form.elements.notas.value = propiedad.notas || "";

    propietariosList.innerHTML = "";
    if (propietarios && propietarios.length) {
      propietarios.forEach((pp) => addPropietarioRow(pp.persona_id, pp.porcentaje));
    } else {
      addPropietarioRow(null, 100);
    }

    photoManager.setImages((fotos || []).map((f) => ({ url: f.url, name: f.url.split("/").pop() })));

    formHeading.textContent = "Editando: " + (propiedad.titulo_publico || propiedad.codigo);
    formHelp.textContent = 'Cambiá lo que haga falta y tocá "Actualizar inmueble" para guardar.';
    submitBtn.textContent = "Actualizar inmueble";
    cancelEditBtn.style.display = "inline-block";
    resultBox.style.display = "none";
    onFormChange();
    window.adminSwitchTab("nueva");
  }

  cancelEditBtn.addEventListener("click", prepararNuevo);

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
    sincronizarAmenitiesHidden();
    const data = new FormData(form);

    const operation = V.unoDe(data.get("operation"), ["venta", "alquiler", "ambas", "temporal"], "venta");
    const conVenta = llevaVenta(operation);
    const conAlquiler = llevaAlquiler(operation);
    const monedaVenta = data.get("currency_venta") === "ARS" ? "ARS" : "USD";
    const monedaAlquiler = data.get("currency_alquiler") === "USD" ? "USD" : "ARS";
    const precioVenta = conVenta ? Dinero.aCentavos(data.get("price_venta")) : null;
    const precioAlquiler = conAlquiler ? Dinero.aCentavos(data.get("price_alquiler")) : null;
    const amenities = (data.get("amenities") || "").split(",").map((a) => a.trim()).filter(Boolean);
    const propietarios = leerPropietariosDelForm();

    if (conVenta && (precioVenta === null || precioVenta < 0)) return avisar("El precio de venta no es un número válido. Escribilo solo con números, por ejemplo 85.000.", "error");
    if (conAlquiler && (precioAlquiler === null || precioAlquiler < 0)) return avisar("El precio de alquiler no es un número válido. Escribilo solo con números, por ejemplo 450.000.", "error");
    if (data.get("area") && V.decimalGrande(data.get("area")) === null) return avisar("La superficie total no es un número válido.", "error");
    if (data.get("superficie_cubierta") && V.decimalGrande(data.get("superficie_cubierta")) === null) return avisar("La superficie cubierta no es un número válido.", "error");
    if (data.get("expensas") && Dinero.aCentavos(data.get("expensas")) === null) return avisar("Las expensas no son un número válido.", "error");
    if (data.get("comision_admin_pct") && V.decimal(data.get("comision_admin_pct")) === null) return avisar("La comisión no es un número válido (ej: 10,5).", "error");

    if (propietarios.length) {
      const suma = propietarios.reduce((t, p) => t + (p.porcentaje || 0), 0);
      if (Math.abs(suma - 100) > 0.01) {
        return avisar(`Los porcentajes de los propietarios suman ${suma}%. Tienen que sumar 100%.`, "error");
      }
    }

    submitBtn.disabled = true;
    submitBtn.textContent = editingId ? "Actualizando…" : "Guardando…";

    try {
      let codigo = V.texto(data.get("codigo"));
      if (codigo) {
        // El código es único: si ya lo usa otro inmueble, avisamos con un
        // mensaje claro en vez del error técnico de la base de datos.
        let consulta = supabaseClient.from("propiedades").select("id, codigo, titulo_publico").eq("codigo", codigo);
        if (editingId) consulta = consulta.neq("id", editingId);
        const { data: repetidos, error: errorCodigo } = await consulta;
        if (errorCodigo) throw errorCodigo;
        if (repetidos && repetidos.length) throw new Error(mensajeCodigoRepetido(codigo, repetidos[0]));
      } else if (!editingId) {
        const { data: codigoGenerado, error: errorCodigo } = await supabaseClient.rpc("siguiente_codigo_propiedad");
        if (errorCodigo) throw errorCodigo;
        codigo = codigoGenerado;
      }

      const payload = {
        tipo: data.get("type"),
        operacion: operation,
        estado: data.get("estado"),
        calle: V.texto(data.get("calle")),
        numero: V.texto(data.get("numero")),
        barrio: V.texto(data.get("zone")),
        localidad: V.texto(data.get("localidad")) || "San Salvador de Jujuy",
        provincia: "Jujuy",
        dormitorios: V.entero(data.get("bedrooms")) || 0,
        banos: V.entero(data.get("bathrooms")) || 0,
        cocheras: V.entero(data.get("cocheras")) || 0,
        ambientes: V.entero(data.get("ambientes")),
        superficie_total: V.decimalGrande(data.get("area")),
        superficie_cubierta: V.decimalGrande(data.get("superficie_cubierta")),
        antiguedad: V.entero(data.get("antiguedad")),
        piso: V.texto(data.get("piso")),
        departamento: V.texto(data.get("departamento")),
        descripcion: V.texto(data.get("description"), { max: 4000 }),
        precio_alquiler: precioAlquiler,
        moneda_alquiler: monedaAlquiler,
        precio_venta: precioVenta,
        moneda_venta: monedaVenta,
        expensas: Dinero.aCentavos(data.get("expensas")),
        comision_admin_pct: V.decimal(data.get("comision_admin_pct")),
        publicar_web: data.get("publicar_web") === "on",
        titulo_publico: V.texto(data.get("titulo_publico")),
        descripcion_publica: V.texto(data.get("description"), { max: 4000 }),
        ocultar_direccion: data.get("ocultar_direccion") === "on",
        amenities,
        notas: V.texto(data.get("notas"), { max: 4000 }),
      };
      if (codigo) payload.codigo = codigo;

      const yaExistia = !!editingId;
      let propiedadId = editingId;
      if (editingId) {
        const { error } = await supabaseClient.from("propiedades").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { data: inserted, error } = await supabaseClient.from("propiedades").insert(payload).select("id").single();
        if (error) throw error;
        propiedadId = inserted.id;
        // A partir de acá el inmueble ya existe: si falla algo después (ej. la
        // subida de fotos) y se vuelve a tocar Guardar, se actualiza este
        // mismo inmueble en vez de crear uno repetido.
        editingId = propiedadId;
        form.elements.codigo.value = codigo || "";
      }

      const { error: propError } = await supabaseClient.rpc("reemplazar_propietarios", {
        p_propiedad_id: propiedadId,
        p_propietarios: propietarios,
      });
      if (propError) throw propError;

      let urls;
      try {
        urls = await uploadNewImages(photoManager.getImages());
      } catch (errFotos) {
        throw new Error(`Los datos del inmueble quedaron guardados, pero no se pudieron subir las fotos (${errFotos.message || errFotos}). Volvé a tocar "Actualizar inmueble" para reintentar — no se va a duplicar.`);
      }
      const { error: borrarFotosError } = await supabaseClient.from("propiedad_foto").delete().eq("propiedad_id", propiedadId);
      if (borrarFotosError) throw borrarFotosError;
      if (urls.length) {
        const { error: fotosError } = await supabaseClient.from("propiedad_foto").insert(
          urls.map((url, i) => ({ propiedad_id: propiedadId, url, orden: i, es_portada: i === 0 }))
        );
        if (fotosError) throw fotosError;
      }

      const wasEditing = yaExistia;
      resultBox.style.display = "block";
      resultBox.innerHTML = `
        <div class="admin-card" style="border-color: var(--color-secondary); background: var(--color-bg-alt);">
          <h2>✅ Inmueble ${wasEditing ? "actualizado" : "publicado"}</h2>
          <p>Ya está guardado${payload.publicar_web ? " y visible en el sitio" : " (marcado como no publicado)"}.</p>
        </div>`;
      resultBox.scrollIntoView({ behavior: "smooth", block: "start" });

      prepararNuevo();
      onSaved();
    } catch (err) {
      resultBox.style.display = "block";
      resultBox.innerHTML = `
        <div class="admin-card" style="border-color: var(--color-danger);">
          <h2>❌ No se pudo guardar</h2>
          <p>${V.escaparHtml(traducirError(err))}</p>
        </div>`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = editingId ? "Actualizar inmueble" : "Guardar inmueble";
    }
  });

  function mensajeCodigoRepetido(codigo, otro) {
    const nombre = otro && otro.titulo_publico ? ` ("${otro.titulo_publico}")` : "";
    return `Ya hay otro inmueble con el código ${codigo}${nombre}. Cada inmueble tiene que tener un código distinto: dejá el campo "Código" vacío para que se genere solo. Si es la misma propiedad que ahora también está en venta o en alquiler, no la cargues de nuevo: editá ese inmueble y elegí la operación "Venta y alquiler (las dos)".`;
  }

  function traducirError(err) {
    const msg = (err && err.message) || String(err);
    if ((err && err.code === "23505") || /propiedades_codigo_key/.test(msg)) {
      return mensajeCodigoRepetido(V.texto(form.elements.codigo.value) || "", null);
    }
    if (/row-level security|JWT|No autorizado/i.test(msg)) {
      return "Tu sesión venció. Recargá la página, volvé a entrar al panel y tocá Guardar otra vez.";
    }
    return msg;
  }

  /* --------------------------- Listado (Inmuebles) ---------------------- */
  async function loadList() {
    listBox.innerHTML = `<p style="color:var(--color-text-light);">Cargando…</p>`;
    const { data, error } = await supabaseClient
      .from("propiedades")
      .select("*, propiedad_foto(url, orden)")
      .eq("activo", true)
      .order("creado_en", { ascending: false });

    if (error) {
      listBox.innerHTML = `<p style="color:var(--color-danger);">No se pudo cargar la lista: ${error.message}</p>`;
      return;
    }
    if (!data || data.length === 0) {
      listBox.innerHTML = `<p style="color:var(--color-text-light);">Todavía no hay inmuebles cargados. Andá a "＋ Nuevo inmueble" para cargar el primero.</p>`;
      return;
    }
    cacheInmuebles = data;
    sumarBarriosSugeridos(data.map((p) => p.barrio));

    listBox.innerHTML = data
      .map((p) => {
        const precios = [];
        if (llevaVenta(p.operacion)) precios.push(`${p.moneda_venta} ${(Dinero.aPesos(p.precio_venta) || 0).toLocaleString("es-AR")}`);
        if (llevaAlquiler(p.operacion)) precios.push(`${p.moneda_alquiler} ${(Dinero.aPesos(p.precio_alquiler) || 0).toLocaleString("es-AR")}${p.operacion === "temporal" ? "/noche" : "/mes"}`);
        const foto = (p.propiedad_foto || []).slice().sort((a, b) => a.orden - b.orden)[0];
        return `
      <div class="admin-list-row">
        <div class="admin-list-thumb">${foto ? `<img src="${foto.url}" alt="">` : ""}</div>
        <div class="admin-list-info">
          <span class="admin-list-title">${p.titulo_publico || p.codigo || typeLabel(p.tipo)}</span>
          ${!p.publicar_web ? `<span class="admin-status-badge">No publicado</span>` : ""}
          <span class="admin-list-meta" style="display:block;">${p.codigo || ""} · ${operationLabel(p.operacion)} · ${typeLabel(p.tipo)} · ${precios.join(" + ")} · ${p.estado}</span>
        </div>
        <div class="admin-list-actions">
          <button type="button" class="btn btn-sm btn-dark" data-editar-inmueble="${p.id}">Editar</button>
          <button type="button" class="admin-delete-link" data-desactivar-inmueble="${p.id}">Desactivar</button>
        </div>
      </div>`;
      })
      .join("");

    listBox.querySelectorAll("[data-editar-inmueble]").forEach((btn) => {
      btn.addEventListener("click", () => startEdit(parseInt(btn.dataset.editarInmueble, 10)));
    });
    listBox.querySelectorAll("[data-desactivar-inmueble]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = parseInt(btn.dataset.desactivarInmueble, 10);
        if (!confirm("Esto saca el inmueble del sitio y de la lista. No se borra el historial — se puede reactivar más adelante.\n\n¿Seguro?")) return;
        const { error } = await supabaseClient.from("propiedades").update({ activo: false }).eq("id", id);
        if (error) return avisar("No se pudo desactivar: " + error.message, "error");
        loadList();
        loadFeatured();
      });
    });
  }

  /* ------------------------------ Destacadas -------------------------- */
  async function loadFeatured() {
    featuredBox.innerHTML = `<p style="color:var(--color-text-light);">Cargando…</p>`;
    const { data, error } = await supabaseClient
      .from("propiedades")
      .select("*")
      .eq("activo", true)
      .eq("publicar_web", true)
      .order("creado_en", { ascending: false });

    if (error) {
      featuredBox.innerHTML = `<p style="color:var(--color-danger);">No se pudo cargar la lista: ${error.message}</p>`;
      return;
    }
    if (!data || data.length === 0) {
      featuredBox.innerHTML = `<p style="color:var(--color-text-light);">No hay inmuebles publicados para destacar. Publicá alguno desde "Inmuebles".</p>`;
      return;
    }
    featuredBox.innerHTML = data
      .map(
        (p) => `
      <div class="admin-list-row">
        <div class="admin-list-info">
          <span class="admin-list-title">${p.titulo_publico || p.codigo}</span>
          <span class="admin-list-meta">${operationLabel(p.operacion)} · ${typeLabel(p.tipo)}</span>
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
        const { error } = await supabaseClient.from("propiedades").update({ featured: checkbox.checked }).eq("id", id);
        checkbox.disabled = false;
        if (error) {
          avisar("No se pudo guardar: " + error.message, "error");
          checkbox.checked = !checkbox.checked;
        }
      });
    });
  }

  return {
    init({ photoManager: pm, onSaved: cb }) {
      photoManager = pm;
      onSaved = cb || (() => {});
    },
    loadList,
    loadFeatured,
    startEdit,
    prepararNuevo,
    isEditing: () => !!editingId,
    refreshPreview: actualizarVistaPrevia,
  };
})();
