(function () {
  const select = document.getElementById("appearance");
  const saved = localStorage.getItem("hip-appearance") || "system";

  function apply(value) {
    if (value === "light" || value === "dark") {
      document.documentElement.dataset.theme = value;
    } else {
      delete document.documentElement.dataset.theme;
    }
    localStorage.setItem("hip-appearance", value);
  }

  select.value = saved;
  apply(saved);
  select.addEventListener("change", () => apply(select.value));
})();
