/**
 * i18n.js — Internationalization module
 * Uses chrome.i18n.getMessage() to translate all elements with data-i18n attributes.
 */

/**
 * Shorthand helper to get a translated message.
 * @param {string} key - The message key from _locales messages.json
 * @param {Array<string>} [substitutions] - Optional substitution values
 * @returns {string} The translated string, or the key itself as fallback
 */
export function t(key, substitutions) {
  const msg = chrome.i18n.getMessage(key, substitutions);
  return msg || key;
}

/**
 * Translates all DOM elements containing data-i18n or data-i18n-tooltip attributes.
 * - data-i18n="key" → sets textContent
 * - data-i18n-tooltip="key" → sets data-tooltip attribute
 * - data-i18n-placeholder="key" → sets placeholder attribute
 */
export function translatePage() {
  // Translate textContent
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    const translated = t(key);
    if (translated !== key) {
      el.textContent = translated;
    }
  });

  // Translate tooltips
  document.querySelectorAll("[data-i18n-tooltip]").forEach(el => {
    const key = el.getAttribute("data-i18n-tooltip");
    const translated = t(key);
    if (translated !== key) {
      el.setAttribute("data-tooltip", translated);
    }
  });

  // Translate placeholders
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    const translated = t(key);
    if (translated !== key) {
      el.setAttribute("placeholder", translated);
    }
  });
}
