document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll(".ans-badge:not(.sample)").forEach(function (badge) {
    var li = badge.closest("li.has-answer");
    if (!li) return;
    function toggle() {
      li.classList.toggle("open");
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
