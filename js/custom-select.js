/* =====================================================================
   PATRICIA DAADIN — select personalizado
   ---------------------------------------------------------------------
   La lista desplegada de un <select> nativo la dibuja el sistema
   operativo, no el CSS del sitio — por eso se veía con la tipografía y
   los colores por defecto de Windows en vez de los del sitio. Esto
   reemplaza visualmente cada <select> por un botón + una lista propia,
   manteniendo el <select> original oculto (pero sincronizado) para que
   el resto del código (validaciones, filtros, envío de formularios)
   siga funcionando exactamente igual sin tocar nada más.
   ===================================================================== */

function enhanceCustomSelect(select) {
  if (select.dataset.cselDone) return;
  select.dataset.cselDone = "1";

  const wrap = document.createElement("div");
  wrap.className = "csel";
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);
  select.classList.add("csel-native");
  select.setAttribute("tabindex", "-1");
  select.setAttribute("aria-hidden", "true");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "csel-btn";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  if (select.id) btn.setAttribute("aria-labelledby", `${labelFor(select)} ${select.id}-csel-label`);

  const labelSpan = document.createElement("span");
  labelSpan.className = "csel-btn-label";
  labelSpan.id = select.id ? `${select.id}-csel-label` : "";

  btn.innerHTML = `<svg class="csel-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
  btn.prepend(labelSpan);

  const list = document.createElement("ul");
  list.className = "csel-list";
  list.setAttribute("role", "listbox");
  list.hidden = true;

  const options = () => Array.from(select.options);
  let activeIndex = select.selectedIndex;

  function render() {
    list.innerHTML = "";
    options().forEach((opt, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.dataset.index = String(i);
      li.textContent = opt.textContent;
      li.id = `${select.id || "csel"}-opt-${i}`;
      if (opt.disabled) li.setAttribute("aria-disabled", "true");
      if (i === select.selectedIndex) {
        li.classList.add("is-selected");
        li.setAttribute("aria-selected", "true");
      }
      list.appendChild(li);
    });
    const current = select.options[select.selectedIndex];
    labelSpan.textContent = current ? current.textContent : "";
  }

  function positionList() {
    // Si no entra hacia abajo pero sí hacia arriba, se abre para arriba.
    list.classList.remove("csel-list--up");
    const rect = wrap.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const needed = Math.min(list.scrollHeight || 260, 260);
    if (spaceBelow < needed && rect.top > needed) {
      list.classList.add("csel-list--up");
    }
  }

  function onDocClick(e) {
    if (!wrap.contains(e.target)) close();
  }

  function updateActiveDescendant() {
    Array.from(list.children).forEach((li, i) => li.classList.toggle("is-active", i === activeIndex));
    const activeLi = list.children[activeIndex];
    if (activeLi) {
      btn.setAttribute("aria-activedescendant", activeLi.id);
      activeLi.scrollIntoView({ block: "nearest" });
    }
  }

  function open() {
    if (!list.hidden) return;
    list.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    wrap.classList.add("is-open");
    activeIndex = select.selectedIndex < 0 ? 0 : select.selectedIndex;
    updateActiveDescendant();
    positionList();
    document.addEventListener("click", onDocClick, true);
  }

  function close() {
    if (list.hidden) return;
    list.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    wrap.classList.remove("is-open");
    document.removeEventListener("click", onDocClick, true);
  }

  function selectIndex(i) {
    const opts = options();
    if (i < 0 || i >= opts.length || opts[i].disabled) return;
    const changed = select.selectedIndex !== i;
    select.selectedIndex = i;
    render();
    close();
    btn.focus();
    if (changed) {
      select.dispatchEvent(new Event("change", { bubbles: true }));
      select.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  btn.addEventListener("click", () => {
    if (list.hidden) open();
    else close();
  });

  btn.addEventListener("keydown", (e) => {
    const nav = ["ArrowDown", "ArrowUp", "Enter", " ", "Escape", "Home", "End"];
    if (nav.includes(e.key)) e.preventDefault();
    if (list.hidden) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) open();
      return;
    }
    if (e.key === "Escape") return close();
    const opts = options();
    if (e.key === "ArrowDown") activeIndex = Math.min(opts.length - 1, activeIndex + 1);
    else if (e.key === "ArrowUp") activeIndex = Math.max(0, activeIndex - 1);
    else if (e.key === "Home") activeIndex = 0;
    else if (e.key === "End") activeIndex = opts.length - 1;
    else if (e.key === "Enter" || e.key === " ") return selectIndex(activeIndex);
    else return;
    updateActiveDescendant();
  });

  list.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    selectIndex(parseInt(li.dataset.index, 10));
  });

  // Si algo (código existente) cambia el valor con el evento nativo
  // "change" (o el select se reconstruye), la etiqueta se actualiza sola.
  select.addEventListener("change", render);

  // Si algo asigna select.value = "..." directamente (sin pasar por un
  // evento), interceptamos esa asignación puntual para mantener la
  // etiqueta del botón sincronizada sin tener que tocar ese otro código.
  const nativeDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  Object.defineProperty(select, "value", {
    configurable: true,
    get() {
      return nativeDescriptor.get.call(select);
    },
    set(v) {
      nativeDescriptor.set.call(select, v);
      render();
    },
  });

  // form.reset() no dispara "change" en cada campo — escuchamos el
  // "reset" del formulario contenedor para refrescar la etiqueta.
  const form = select.closest("form");
  if (form) form.addEventListener("reset", () => setTimeout(render, 0));

  wrap.appendChild(btn);
  wrap.appendChild(list);
  render();
}

function labelFor(select) {
  const label = select.id ? document.querySelector(`label[for="${select.id}"]`) : null;
  if (label && !label.id) label.id = `${select.id}-label`;
  return label ? label.id : "";
}

function enhanceAllCustomSelects(root) {
  (root || document).querySelectorAll("select").forEach(enhanceCustomSelect);
}

document.addEventListener("DOMContentLoaded", () => enhanceAllCustomSelects());
