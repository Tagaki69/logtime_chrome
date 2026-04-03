// profile-content-script.js
// Injects monthly logtime totals & Friends card on https://profile.intra.42.fr/

(function () {
  "use strict";

  // ─── Utility ───────────────────────────────────────────────────────────────
  function minutesToHM(mins) {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return `${h}h${m.toString().padStart(2, "0")}`;
  }

  /** Parse an "Xh Ym" or HH:MM:SS logtime string into total minutes. */
  function parseLogTime(str) {
    if (!str) return 0;
    // "5:23:11" format from locations_stats.json
    const parts = str.split(":");
    if (parts.length === 3) {
      return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10) + parseInt(parts[2], 10) / 60;
    }
    return 0;
  }

  // Map short month → index (0‑based)
  const MONTH_MAP = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };

  // ─── 1. Monthly Logtime Totals ───────────────────────────────────────────
  function getProfileUserName() {
    // On own profile (/) or /users/<login>
    const path = window.location.pathname;
    if (path.startsWith("/users/")) {
      return path.split("/")[2];
    }
    // Own profile: read from the top-bar login span
    const loginSpan = document.querySelector("span[data-login]");
    if (loginSpan) return loginSpan.getAttribute("data-login");
    return null;
  }

  /**
   * Find all month header <th> inside the Logtime card and annotate
   * them with "(XXhYY)" totals fetched from local storage (calculated by background.js).
   */
  function injectMonthlyTotals() {
    chrome.storage.local.get(["monthlyLogtime", "username"], function (data) {
      const sumsPerMonth = data.monthlyLogtime || {};
      const ownLogin = data.username;
      const currentProfileLogin = getProfileUserName();

      // Only inject if viewing own profile
      if (!ownLogin || !currentProfileLogin || ownLogin !== currentProfileLogin) {
        return;
      }
      
      // Find the "Logtime" card title
      const titleDivs = document.querySelectorAll(".font-bold.text-black.uppercase.text-sm");
      let logtimeCard = null;
      titleDivs.forEach(function (el) {
        if (el.textContent.trim().toLowerCase() === "logtime") {
          // Walk up to the card root
          logtimeCard = el.closest(".bg-white") || el.closest("[class*='bg-white']");
        }
      });
      if (!logtimeCard) return;

      // Grab month headers
      const monthHeaders = logtimeCard.querySelectorAll("th[colspan='7']");
      if (!monthHeaders.length) return;

      monthHeaders.forEach(function (th) {
        // Get month name, handling cases where we've already modified it
        // The original text is just "Jan", "Feb", etc.
        const originalText = th.getAttribute("data-original-month") || th.textContent.trim().split(" ")[0];
        if (!th.hasAttribute("data-original-month")) {
          th.setAttribute("data-original-month", originalText);
        }

        const totalMins = sumsPerMonth[originalText] || 0;
        
        // Update header: "Jan (50h38)"
        th.innerHTML = `${originalText} <span style="font-weight: 400; font-size: 0.85em; margin-left: 5px; color: #00868a; opacity: 0.8;">(${minutesToHM(totalMins)})</span>`;
      });
    });
  }

  // ─── 2. Friends Card ───────────────────────────────────────────────────────
  function injectFriendsCard() {
    chrome.storage.local.get(["cachedFriends", "friendsList"], function (data) {
      const friendsList = data.friendsList || [];
      const friendsStats = data.cachedFriends || {};
      if (friendsList.length === 0 && Object.keys(friendsStats).length === 0) return;

      // Find the "Last achievements" card to place Friends next to it
      const titleDivs = document.querySelectorAll(".font-bold.text-black.uppercase.text-sm");
      let achievementsCard = null;
      titleDivs.forEach(function (el) {
        if (el.textContent.trim().toLowerCase() === "last achievements") {
          achievementsCard = el.closest(".bg-white.md\\:h-96") || el.closest("[class*='bg-white']");
        }
      });
      if (!achievementsCard) return;
      // Prevent double-injection
      if (document.getElementById("logtime42-friends-card")) return;

      // ── Build the card ──
      const card = document.createElement("div");
      card.id = "logtime42-friends-card";
      card.className = achievementsCard.className; // clone styling classes
      card.style.overflow = "hidden";

      // Inner wrapper matching the Intra card structure
      const inner = document.createElement("div");
      inner.className = "flex flex-col w-full h-full";

      // Title bar
      const titleBar = document.createElement("div");
      titleBar.className = "flex flex-col gap-1 md:flex-row place-items-center justify-between mb-2";
      const title = document.createElement("div");
      title.className = "font-bold text-black uppercase text-sm";
      title.textContent = "Friends";
      titleBar.appendChild(title);
      inner.appendChild(titleBar);

      // Friends list container
      const listContainer = document.createElement("div");
      listContainer.className = "h-full";
      listContainer.style.overflowY = "auto";

      const friendKeys = Object.keys(friendsStats);
      if (friendKeys.length === 0 && friendsList.length > 0) {
        // Friends configured but no data yet
        const emptyMsg = document.createElement("div");
        emptyMsg.style.cssText =
          "display:flex;align-items:center;justify-content:center;height:100%;color:#888;font-size:13px;";
        emptyMsg.textContent = "Loading friends data…";
        listContainer.appendChild(emptyMsg);
      } else {
        // Sort: online first, then alphabetical
        friendKeys.sort(function (a, b) {
          const aOnline = friendsStats[a].active ? 1 : 0;
          const bOnline = friendsStats[b].active ? 1 : 0;
          if (aOnline !== bOnline) return bOnline - aOnline;
          return a.localeCompare(b);
        });

        friendKeys.forEach(function (login) {
          const f = friendsStats[login];
          const row = document.createElement("a");
          row.href = "https://profile.intra.42.fr/users/" + login;
          row.style.cssText =
            "display:flex;align-items:center;gap:10px;padding:8px 10px;text-decoration:none;color:inherit;" +
            "border-bottom:1px solid #f0f0f0;transition:background .15s;cursor:pointer;";
          row.addEventListener("mouseenter", function () { row.style.background = "#f8f8f8"; });
          row.addEventListener("mouseleave", function () { row.style.background = "transparent"; });

          // Avatar
          const avatar = document.createElement("div");
          avatar.style.cssText =
            "width:34px;height:34px;border-radius:50%;overflow:hidden;flex-shrink:0;" +
            "background:#e0e0e0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;color:#555;";
          if (f.avatar) {
            const img = document.createElement("img");
            img.src = f.avatar;
            img.alt = login;
            img.style.cssText = "width:100%;height:100%;object-fit:cover;";
            avatar.appendChild(img);
          } else {
            avatar.textContent = login.substring(0, 2).toUpperCase();
          }
          row.appendChild(avatar);

          // Info block
          const info = document.createElement("div");
          info.style.cssText = "flex:1;min-width:0;";

          const nameRow = document.createElement("div");
          nameRow.style.cssText = "display:flex;align-items:center;gap:6px;";

          const nameSpan = document.createElement("span");
          nameSpan.style.cssText = "font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
          nameSpan.textContent = login;
          nameRow.appendChild(nameSpan);

          // Online indicator
          const statusDot = document.createElement("span");
          statusDot.style.cssText =
            "width:8px;height:8px;border-radius:50%;flex-shrink:0;" +
            (f.active ? "background:#22c55e;" : "background:#d1d5db;");
          nameRow.appendChild(statusDot);

          info.appendChild(nameRow);

          // Logtime + location line
          const detailRow = document.createElement("div");
          detailRow.style.cssText = "font-size:11px;color:#888;margin-top:1px;display:flex;gap:8px;";

          // Level
          const lvlSpan = document.createElement("span");
          lvlSpan.style.cssText = "color:#00babc;font-weight:700;";
          lvlSpan.textContent = "Lvl " + (f.level || 0).toFixed(2);
          detailRow.appendChild(lvlSpan);

          // Compute logtime
          let totalMs = f.totalMs || 0;
          const fh = Math.floor(totalMs / 3600000);
          const fm = Math.floor((totalMs % 3600000) / 60000);
          const ltSpan = document.createElement("span");
          ltSpan.textContent = "⏱ " + fh + "h" + fm.toString().padStart(2, "0");
          detailRow.appendChild(ltSpan);


          if (f.active) {
            const locSpan = document.createElement("span");
            locSpan.style.cssText = "color:#22c55e;";
            locSpan.textContent = "📍 " + f.active;
            detailRow.appendChild(locSpan);
          }

          info.appendChild(detailRow);
          row.appendChild(info);
          listContainer.appendChild(row);
        });
      }

      inner.appendChild(listContainer);
      card.appendChild(inner);

      // Insert after the achievements card
      achievementsCard.parentElement.insertBefore(card, achievementsCard.nextSibling);
    });
  }

  // ─── 3. Inject Styles ──────────────────────────────────────────────────────
  function injectStyles() {
    const style = document.createElement("style");
    style.id = "logtime42-profile-styles";
    style.textContent = `
      #logtime42-friends-card a:hover {
        background: #f5f5f5 !important;
      }
      #logtime42-monthly-banner {
        animation: lt42fadeIn .4s ease;
      }
      @keyframes lt42fadeIn {
        from { opacity: 0; transform: translateY(-6px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }

  // ─── 4. Boot ───────────────────────────────────────────────────────────────
  function boot() {
    // Only run on profile pages
    const path = window.location.pathname;
    if (path !== "/" && !path.startsWith("/users/")) return;

    injectStyles();

    // Wait for the React app to render the grid before injecting
    function tryInject(attempt) {
      const cards = document.querySelectorAll(".font-bold.text-black.uppercase.text-sm");
      if (cards.length >= 3 || attempt > 20) {
        injectMonthlyTotals();
        injectFriendsCard();
      } else {
        setTimeout(function () { tryInject(attempt + 1); }, 500);
      }
    }
    tryInject(0);
  }

  // The React profile app renders asynchronously — give it a moment
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 1500); });
  } else {
    setTimeout(boot, 1500);
  }

  console.log("%c✅ Logtime42 Profile Enhancer loaded!", "color: #00babc; font-size: 14px;");
})();
