/* =====================================================================
   PATRICIA DAADIN — comportamiento compartido de todas las páginas
   Menú móvil, resaltado de link activo, año del footer.
   ===================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  // Menú hamburguesa (mobile)
  const header = document.querySelector(".site-header");
  const toggle = document.querySelector(".nav-toggle");

  if (header && toggle) {
    toggle.addEventListener("click", () => {
      header.classList.toggle("is-open");
      toggle.classList.toggle("is-open");
    });

    // Cerrar el menú al elegir una opción (mobile)
    document.querySelectorAll(".main-nav a").forEach((link) => {
      link.addEventListener("click", () => {
        header.classList.remove("is-open");
        toggle.classList.remove("is-open");
      });
    });
  }

  // Resaltar el link activo según el archivo actual
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".main-nav a[data-page]").forEach((link) => {
    if (link.dataset.page === currentPage) {
      link.classList.add("active");
    }
  });

  // Año dinámico en el footer
  document.querySelectorAll("[data-year]").forEach((el) => {
    el.textContent = new Date().getFullYear();
  });
});
