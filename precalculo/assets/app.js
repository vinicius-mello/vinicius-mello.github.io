document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll(".ans-badge:not(.sample)").forEach(function (badge) {
    var li = badge.closest("li.has-answer");
    if (!li) return;
    function toggle() {
      var open = li.classList.toggle("open");
      badge.setAttribute("aria-pressed", open ? "true" : "false");
    }
    badge.addEventListener("click", toggle);
    badge.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
  });
});
