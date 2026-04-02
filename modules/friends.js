/**
 * friends.js — Friends list rendering module
 * Uses HTML <template> for efficient DOM construction.
 */
import { t } from './i18n.js';

/**
 * Renders the friends list from cached friend stats.
 * Uses the #friend-row-template for clean DOM construction.
 * @param {Object} friendsStats - Map of login → { totalMs, locs, active, avatar, refreshing }
 */
export function renderFriends(friendsStats) {
  const box = document.getElementById("friendsBox");
  box.innerHTML = "";

  const friendsKeys = Object.keys(friendsStats);
  if (friendsKeys.length === 0) {
    box.innerHTML = `<div class="loading">${t("noFriends")}</div>`;
    return;
  }

  // Sort: online first, then alphabetical
  friendsKeys.sort((a, b) => {
    if (friendsStats[a].active && !friendsStats[b].active) return -1;
    if (!friendsStats[a].active && friendsStats[b].active) return 1;
    return a.localeCompare(b);
  });

  const template = document.getElementById("friend-row-template");

  friendsKeys.forEach(login => {
    const f = friendsStats[login];

    // Support either the new totalMs or the old locs array
    let totalMs = f.totalMs || 0;
    if (totalMs === 0 && f.locs && Array.isArray(f.locs)) {
      f.locs.forEach(l => {
        totalMs += ((l.end_at ? new Date(l.end_at) : new Date()) - new Date(l.begin_at));
      });
    }

    const fh = Math.floor(totalMs / 3600000);
    const fm = Math.floor((totalMs % 3600000) / 60000);

    // Clone template
    const clone = template.content.cloneNode(true);
    const row = clone.querySelector(".friend-row");
    row.onclick = () => {
      chrome.tabs.create({ url: `https://profile.intra.42.fr/users/${login}` });
    };

    // Avatar
    const av = clone.querySelector(".friend-avatar");
    if (f.avatar) {
      av.innerHTML = `<img src="${f.avatar}" alt="${login}">`;
    } else {
      av.textContent = login.substring(0, 2).toUpperCase();
    }

    // Info
    clone.querySelector(".friend-name").textContent = login;
    clone.querySelector(".friend-logtime").textContent = `${fh}h ${fm}m`;

    // Status
    const st = clone.querySelector(".friend-status");
    if (f.refreshing) {
      st.innerHTML = `<div class="status-offline" style="color:#f39c12; font-size:12px;">🔄...</div>`;
    } else if (f.active) {
      st.innerHTML = `<span class="friend-location">${f.active}</span> <span class="status-online">🟢</span>`;
    } else {
      st.innerHTML = `<div class="status-offline">🔴 Off</div>`;
    }

    box.appendChild(clone);
  });
}
