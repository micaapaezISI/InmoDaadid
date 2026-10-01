/* =====================================================================
   PATRICIA DAADIN — Panel admin: ubicación del inmueble en el mapa
   ---------------------------------------------------------------------
   Mapa (Leaflet + OpenStreetMap, sin API key) para marcar el punto exacto
   de la propiedad: tocando el mapa, arrastrando el pin, pegando un link
   de Google Maps / coordenadas, o buscando la dirección escrita en el
   formulario. El punto se guarda en propiedades.latitud/longitud y la
   ficha pública lo muestra en un mapa de Google Maps (property-detail.js).
   ===================================================================== */

const AdminMapa = (() => {
  const CENTRO_JUJUY = [-24.1858, -65.2995];

  const contenedor = document.getElementById("p-mapa");
  const linkInput = document.getElementById("p-mapa-link");
  const estado = document.getElementById("p-mapa-estado");
  const latInput = document.getElementById("p-latitud");
  const lngInput = document.getElementById("p-longitud");

  let mapa = null;
  let pin = null;
  let punto = null;
  let teniaPunto = false;

  function crearMapa() {
    if (mapa || !contenedor || typeof L === "undefined") return;
    mapa = L.map(contenedor, { scrollWheelZoom: false }).setView(CENTRO_JUJUY, 13);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(mapa);
    mapa.on("click", (e) => marcar({ lat: e.latlng.lat, lng: e.latlng.lng }));
    dibujar(true);
  }

  function redondear(n) {
    return Math.round(n * 1e6) / 1e6;
  }

  function dibujar(centrar) {
    latInput.value = punto ? punto.lat : "";
    lngInput.value = punto ? punto.lng : "";
    estado.textContent = punto
      ? `📍 Ubicación marcada (${punto.lat.toFixed(5)}, ${punto.lng.toFixed(5)}). Podés arrastrar el pin para ajustarla.`
      : "Sin ubicación marcada — la web va a buscar la dirección escrita arriba.";
    if (!mapa) return;
    if (punto) {
      if (!pin) {
        pin = L.marker([punto.lat, punto.lng], { draggable: true }).addTo(mapa);
        pin.on("dragend", () => {
          const ll = pin.getLatLng();
          marcar({ lat: ll.lat, lng: ll.lng }, false);
        });
      } else {
        pin.setLatLng([punto.lat, punto.lng]);
      }
      if (centrar) mapa.setView([punto.lat, punto.lng], Math.max(mapa.getZoom(), 16));
    } else {
      if (pin) { pin.remove(); pin = null; }
      if (centrar) mapa.setView(CENTRO_JUJUY, 13);
    }
  }

  function marcar(nuevo, centrar = true) {
    punto = nuevo ? { lat: redondear(nuevo.lat), lng: redondear(nuevo.lng) } : null;
    dibujar(centrar);
  }

  // Saca coordenadas de lo que se pegue: links largos de Google Maps
  // (con "@lat,lng", "!3dlat!4dlng" o "?q=lat,lng") o "lat, lng" sueltas.
  function coordenadasDeTexto(texto) {
    const t = decodeURIComponent(String(texto || "").trim());
    const patrones = [
      /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, // punto exacto del lugar elegido
      /[?&](?:q|query|ll|center|destination|daddr)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
      /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
      /^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/,
    ];
    for (const re of patrones) {
      const m = re.exec(t);
      if (m) {
        const lat = parseFloat(m[1]);
        const lng = parseFloat(m[2]);
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
      }
    }
    return null;
  }

  function usarLink() {
    const texto = linkInput.value.trim();
    if (!texto) return avisar("Pegá primero un link de Google Maps o unas coordenadas.", "error");
    const c = coordenadasDeTexto(texto);
    if (c) {
      marcar(c);
      linkInput.value = "";
      avisar("Ubicación marcada en el mapa.");
      return;
    }
    if (/goo\.gl|maps\.app/.test(texto)) {
      return avisar('Ese es un link corto de Google Maps y no trae las coordenadas. Abrilo en la compu, esperá que cargue el mapa y copiá el link largo de la barra de direcciones — o tocá directamente el lugar en el mapa de acá abajo.', "error");
    }
    avisar("No encontré coordenadas en ese texto. Probá con el link largo de Google Maps o tocá el lugar en el mapa.", "error");
  }

  async function buscarDireccion() {
    const form = document.getElementById("admin-property-form");
    const partes = [
      [form.elements.calle.value, form.elements.numero.value].filter(Boolean).join(" "),
      form.elements.zone.value,
      form.elements.localidad.value || "San Salvador de Jujuy",
      "Jujuy",
      "Argentina",
    ].map((x) => (x || "").trim()).filter(Boolean);
    if (partes.length <= 3 && !form.elements.zone.value.trim()) {
      return avisar("Escribí primero la calle, el barrio o la localidad en el formulario.", "error");
    }
    estado.textContent = "Buscando la dirección…";
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&q=${encodeURIComponent(partes.join(", "))}`;
      const res = await fetch(url, { headers: { "Accept-Language": "es" } });
      const datos = await res.json();
      if (!datos.length) {
        dibujar(false);
        return avisar("No encontré esa dirección. Tocá el lugar en el mapa o pegá el link de Google Maps.", "error");
      }
      marcar({ lat: parseFloat(datos[0].lat), lng: parseFloat(datos[0].lon) });
      avisar("Encontré la dirección — revisá que el pin esté bien y arrastralo si hace falta.");
    } catch {
      dibujar(false);
      avisar("No se pudo buscar la dirección ahora. Tocá el lugar en el mapa o pegá el link de Google Maps.", "error");
    }
  }

  document.getElementById("p-mapa-usar-link").addEventListener("click", usarLink);
  document.getElementById("p-mapa-buscar").addEventListener("click", buscarDireccion);
  document.getElementById("p-mapa-quitar").addEventListener("click", () => marcar(null));
  linkInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); usarLink(); }
  });

  return {
    // Al abrir el formulario (nuevo o edición). Guarda si ya tenía punto,
    // para que "Quitar pin" se pueda guardar como borrado.
    setPunto(p) {
      teniaPunto = !!p;
      linkInput.value = "";
      marcar(p);
    },
    getPunto: () => punto,
    teniaPunto: () => teniaPunto,
    // El mapa se crea / reacomoda recién cuando la pestaña está visible
    // (Leaflet no puede medir un contenedor oculto).
    refrescar() {
      setTimeout(() => {
        crearMapa();
        if (mapa) { mapa.invalidateSize(); dibujar(true); }
      }, 50);
    },
    coordenadasDeTexto,
  };
})();
