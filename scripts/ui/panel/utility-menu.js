export function activatePanelUtilityBindings(element) {
  for (const toggle of element.querySelectorAll("[data-plan-why-toggle]")) {
    bindPopoverMenu(element, toggle, toggle.parentElement?.querySelector("[data-plan-why]"), { closeOn: null });
  }
  // The minimal bar's Auto-fill: click fills, right-click explains the plan.
  for (const toggle of element.querySelectorAll("[data-plan-why-context]")) {
    bindPopoverMenu(element, toggle, toggle.parentElement?.querySelector("[data-plan-why]"), { closeOn: null, trigger: "contextmenu" });
  }
}

// Anchors a popover menu under its toggle (right edge, or left for a right-click menu), with
// arrow-key navigation.
export function bindPopoverMenu(element, toggle, menu, { closeOn = "button[data-action]", trigger = "click", align = trigger === "contextmenu" ? "left" : "right" } = {}) {
  if (!toggle || !menu) return;
  const buttons = () => Array.from(menu.querySelectorAll("button:not(:disabled)"));
  const close = () => { menu.hidePopover(); toggle.focus(); };
  const open = () => {
    menu.showPopover();
    const anchor = toggle.getBoundingClientRect();
    const box = menu.getBoundingClientRect();
    const viewport = element.ownerDocument.defaultView;
    const left = align === "left" ? anchor.left : anchor.right - box.width;
    menu.style.left = `${Math.max(8, Math.min(left, viewport.innerWidth - box.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(anchor.bottom + 5, viewport.innerHeight - box.height - 8))}px`;
    buttons()[0]?.focus();
  };
  if (trigger === "contextmenu") {
    toggle.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      globalThis.game?.tooltip?.deactivate?.();
      if (menu.matches(":popover-open")) close();
      else open();
    });
  } else {
    toggle.addEventListener("click", () => menu.matches(":popover-open") ? close() : open());
    toggle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown") return;
      event.preventDefault();
      open();
    });
  }
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
