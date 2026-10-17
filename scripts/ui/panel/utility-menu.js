export function activatePanelUtilityBindings(element) {
  bindPopoverMenu(element, element.querySelector("[data-plan-why-toggle]"), element.querySelector("[data-plan-why]"), { closeOn: null });
}

// Anchors a popover menu under its toggle's right edge, with arrow-key navigation.
export function bindPopoverMenu(element, toggle, menu, { closeOn = "button[data-action]" } = {}) {
  if (!toggle || !menu) return;
  const buttons = () => Array.from(menu.querySelectorAll("button:not(:disabled)"));
  const close = () => { menu.hidePopover(); toggle.focus(); };
  const open = () => {
    menu.showPopover();
    const anchor = toggle.getBoundingClientRect();
    const box = menu.getBoundingClientRect();
    const viewport = element.ownerDocument.defaultView;
    menu.style.left = `${Math.max(8, Math.min(anchor.right - box.width, viewport.innerWidth - box.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(anchor.bottom + 5, viewport.innerHeight - box.height - 8))}px`;
    buttons()[0]?.focus();
  };
  toggle.addEventListener("click", () => menu.matches(":popover-open") ? close() : open());
  toggle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    open();
  });
  menu.addEventListener("toggle", () => toggle.setAttribute("aria-expanded", String(menu.matches(":popover-open"))));
  menu.addEventListener("click", (event) => {
    if (closeOn && event.target.closest(closeOn)) menu.hidePopover();
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    const controls = buttons();
    if (!controls.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = controls.indexOf(element.ownerDocument.activeElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + controls.length) % controls.length;
    controls[index].focus();
  });
  return { open, close };
}
