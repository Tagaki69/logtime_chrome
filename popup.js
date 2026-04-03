/**
 * popup.js — Main entry point (orchestrator)
 * Imports all modules and wires up event listeners.
 */
import { t, translatePage } from './modules/i18n.js';
import { initTooltips, applyCoalitionTheme } from './modules/ui.js';
import { renderStats, calculateLogtime, renderLogtime, calculateDailyTarget } from './modules/stats.js';
import { renderCalendar } from './modules/calendar.js';
import { renderFriends } from './modules/friends.js';

document.addEventListener("DOMContentLoaded", async () => {
  // Translate the page on load
  translatePage();

  // --- Button bindings ---
  document.getElementById("btnSettings").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById("btnRefresh").addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "refresh" }, () => {
      loadData();
    });
    document.getElementById("btnRefresh").style.opacity = "0.3";
    setTimeout(() => { document.getElementById("btnRefresh").style.opacity = "1"; }, 1000);
  });

  document.getElementById("btnProfile").addEventListener("click", async () => {
    const settings = await chrome.storage.local.get("username");
    if (settings.username) {
      chrome.tabs.create({ url: `https://profile.intra.42.fr/users/${settings.username}` });
    } else {
      chrome.runtime.openOptionsPage();
    }
  });

  document.getElementById("btnMatrix").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://matrix.42lyon.fr/claimed" });
  });

  document.getElementById("btnLoginIntra").addEventListener("click", async () => {
    const btn = document.getElementById("btnLoginIntra");
    
    const settings = await chrome.storage.local.get(['clientId', 'clientSecret', 'username']);
    if (!settings.clientId || !settings.clientSecret || !settings.username) {
      chrome.runtime.openOptionsPage();
      return;
    }

    btn.textContent = t("connecting");
    btn.disabled = true;
    chrome.runtime.sendMessage({ action: "login" }, (response) => {
      const err = chrome.runtime.lastError;
      btn.textContent = t("logIn");
      btn.disabled = false;

      if (err) {
        alert(t("errorReload") + " " + err.message);
        return;
      }

      if (response && response.status === "success") {
        document.getElementById("loginOverlay").style.display = "none";
        loadData();
      } else {
        alert(t("errorOAuth") + ": " + (response && response.error ? response.error : "Unknown"));
        if (response && response.error && response.error.includes("configurer votre UID")) {
          chrome.runtime.openOptionsPage();
        }
      }
    });
  });

  document.getElementById("btnCalendar").addEventListener("click", () => {
    document.getElementById("friendsView").style.display = "none";
    document.getElementById("calendarView").style.display = "block";
    document.getElementById("btnCalendar").style.display = "none";
    document.getElementById("btnFriends").style.display = "inline-block";
    document.getElementById("friendsTitle").textContent = t("myCalendar");
  });

  document.getElementById("btnFriends").addEventListener("click", () => {
    document.getElementById("calendarView").style.display = "none";
    document.getElementById("friendsView").style.display = "block";
    document.getElementById("btnFriends").style.display = "none";
    document.getElementById("btnCalendar").style.display = "inline-block";
    document.getElementById("friendsTitle").textContent = t("friendsStatus");
  });

  // Listen for progressive updates
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.cachedFriends) {
        renderFriends(changes.cachedFriends.newValue);
        initTooltips();
      }
      // Reactive UI: update personal stats as soon as they arrive in storage
      if (changes.cachedLocations || changes.cachedStats) {
        loadData();
      }
    }
  });

  await loadData();
});

/**
 * Loads all data from chrome.storage and triggers rendering.
 */
async function loadData() {
  const data = await chrome.storage.local.get([
    'cachedLocations', 'cachedStats', 'cachedFriends', 'cachedCoalition',
    'username', 'giftDays', 'freezeDays', 'enableCoalitionTheme', 'days',
    'userCampus', 'userAvatar', 'accessToken', 'clientId', 'clientSecret'
  ]);

  if (!data.username || !data.accessToken || !data.clientId || !data.clientSecret) {
    document.getElementById("loginOverlay").style.display = "flex";
    return;
  } else {
    document.getElementById("loginOverlay").style.display = "none";
  }

  // If no cached stats yet, force a silent refresh
  if (!data.cachedStats) {
    document.getElementById("mainTime").textContent = t("loading");
    chrome.runtime.sendMessage({ action: "refresh" }, async (res) => {
      if (res && res.status === "success") {
        const newData = await chrome.storage.local.get([
          'cachedLocations', 'cachedStats', 'cachedFriends', 'cachedCoalition',
          'giftDays', 'freezeDays', 'enableCoalitionTheme', 'days',
          'userCampus', 'userAvatar'
        ]);
        Object.assign(data, newData);
        renderEverything(data);
      } else {
        document.getElementById("mainTime").textContent = t("apiError");
        document.getElementById("ratioTime").textContent = t("checkKeys");
      }
    });
    return;
  }

  renderEverything(data);
}

/**
 * Master render function — orchestrates all module renders.
 * @param {Object} data - All data from chrome.storage
 */
function renderEverything(data) {
  // --- USER BANNER (avatar + login) ---
  if (data.username) {
    const banner = document.getElementById("userBanner");
    const avatarEl = document.getElementById("userAvatar");
    const loginEl = document.getElementById("userLogin");
    loginEl.textContent = data.username;
    if (data.userAvatar) {
      avatarEl.style.display = "";
      avatarEl.src = data.userAvatar;
      avatarEl.alt = data.username;
      avatarEl.onerror = () => { avatarEl.style.display = "none"; };
    } else {
      avatarEl.style.display = "none";
    }
    banner.style.display = "flex";
  }

  // --- MATRIX: Lyon only ---
  const btnMatrix = document.getElementById("btnMatrix");
  if (data.userCampus && data.userCampus.toLowerCase().includes('lyon')) {
    btnMatrix.style.display = "";
  } else {
    btnMatrix.style.display = "none";
  }

  // Stats (wallet, eval, blackhole, XP, project)
  renderStats(data.cachedStats, data.freezeDays);

  // Coalition theme
  applyCoalitionTheme(data.enableCoalitionTheme, data.cachedCoalition);

  // Logtime calculation & rendering
  const { totalMs, todayMs, daysCache } = calculateLogtime(data.cachedLocations);
  const targetHours = renderLogtime(totalMs, todayMs, data.giftDays);

  // Daily target
  calculateDailyTarget(targetHours, totalMs, data.days);

  // Calendar heatmap
  renderCalendar(daysCache);

  // Friends list
  renderFriends(data.cachedFriends || {});

  // Tooltips (after all dynamic content is rendered)
  initTooltips();
}
