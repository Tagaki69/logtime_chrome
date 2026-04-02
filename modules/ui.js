/**
 * ui.js — UI utilities module
 * Handles custom tooltips and coalition theme application.
 */

/**
 * Initializes custom tooltips for all elements with data-tooltip attribute.
 * Must be called after dynamic content is rendered (calendar, friends, etc.).
 */
export function initTooltips() {
  const tooltip = document.getElementById("customTooltip");
  if (!tooltip) return;

  const elements = document.querySelectorAll("[data-tooltip]");

  elements.forEach(el => {
    el.onmouseenter = null;
    el.onmouseleave = null;
    el.onmousemove = null;

    el.onmouseenter = () => {
      tooltip.textContent = el.getAttribute("data-tooltip");
      tooltip.classList.add("show");
    };

    el.onmousemove = (e) => {
      let x = e.clientX + 10;
      let y = e.clientY - 25;

      if (x + tooltip.offsetWidth > document.body.clientWidth) {
        x = document.body.clientWidth - tooltip.offsetWidth - 5;
      }

      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
    };

    el.onmouseleave = () => {
      tooltip.classList.remove("show");
    };
  });
}

/**
 * Applies the coalition theme to the body element.
 * @param {boolean} enabled - Whether coalition theme is enabled
 * @param {Object|null} coalition - Coalition data ({ name, color })
 */
export function applyCoalitionTheme(enabled, coalition) {
  if (enabled && coalition) {
    const coalName = coalition.name.toLowerCase();
    if (coalName.includes('fire') || coalName.includes('flamme') || coalition.color === '#FF0000') {
      document.body.className = "theme-fire";
    } else if (coalName.includes('water') || coalName.includes('eau') || coalition.color === '#0000FF') {
      document.body.className = "theme-water";
    } else if (coalName.includes('earth') || coalName.includes('terre') || coalition.color === '#00FF00') {
      document.body.className = "theme-earth";
    } else if (coalName.includes('air') || coalName.includes('vent') || coalName.includes('wind')) {
      document.body.className = "theme-air";
    } else {
      document.body.style.background = `radial-gradient(ellipse at bottom right, ${coalition.color}40 0%, #1a1a2e 70%)`;
      document.body.style.backgroundColor = '#1a1a2e';
    }
  } else {
    document.body.className = "";
    document.body.style.background = "";
  }
}
