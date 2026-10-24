const dialog = document.querySelector("[data-preview-dialog]");
document.querySelector("[data-open-dialog]")?.addEventListener("click", () => dialog?.showModal());
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => dialog?.close());
});
dialog?.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

document.querySelectorAll(".segmented button").forEach((button) => {
  button.addEventListener("click", () => {
    button.parentElement?.querySelectorAll("button").forEach((item) => item.classList.toggle("selected", item === button));
  });
});

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((item) => item.classList.toggle("is-active", item === link));
  });
});
