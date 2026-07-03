// ================================================================
// GESTIÓN DEL TEMA CLARO / OSCURO
// ================================================================
(function () {
  const STORAGE_KEY = "hr-gastos-tema";
  const html = document.documentElement;

  function aplicarTema(tema) {
    html.setAttribute("data-tema", tema);
    localStorage.setItem(STORAGE_KEY, tema);
    const btn = document.getElementById("btnTema");
    if (btn) btn.textContent = tema === "oscuro" ? "☀️" : "🌙";
  }

  function toggleTema() {
    const actual = html.getAttribute("data-tema") || "claro";
    aplicarTema(actual === "claro" ? "oscuro" : "claro");
  }

  // Aplicar tema guardado inmediatamente (antes del render) para evitar parpadeo
  const guardado = localStorage.getItem(STORAGE_KEY) || "claro";
  aplicarTema(guardado);

  // Exponer globalmente
  window.toggleTema = toggleTema;
})();
