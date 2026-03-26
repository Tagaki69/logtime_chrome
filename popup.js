document.addEventListener("DOMContentLoaded", async () => {
  // Bind actions
  document.getElementById("btnSettings").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
  
  document.getElementById("btnRefresh").addEventListener("click", () => {
    chrome.runtime.sendMessage({action: "refresh"}, () => {
      loadData();
    });
    // Temporary UI feedback
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

  document.getElementById("btnCalendar").addEventListener("click", () => {
    document.getElementById("friendsView").style.display = "none";
    document.getElementById("calendarView").style.display = "block";
    document.getElementById("btnCalendar").style.display = "none";
    document.getElementById("btnFriends").style.display = "inline-block";
    document.getElementById("friendsTitle").textContent = "MON CALENDRIER";
  });

  document.getElementById("btnFriends").addEventListener("click", () => {
    document.getElementById("calendarView").style.display = "none";
    document.getElementById("friendsView").style.display = "block";
    document.getElementById("btnFriends").style.display = "none";
    document.getElementById("btnCalendar").style.display = "inline-block";
    document.getElementById("friendsTitle").textContent = "FRIENDS STATUS";
  });

  await loadData();
});

async function loadData() {
  const data = await chrome.storage.local.get(['cachedLocations', 'cachedStats', 'cachedFriends', 'username', 'giftDays', 'days']);
  
  if (!data.username) {
    document.getElementById("mainTime").textContent = "Config requise";
    document.getElementById("ratioTime").textContent = "Clique sur l'engrenage ⚙️";
    return;
  }

  // Si on a pas encore de stats en cache, on force un refresh silencieux
  if (!data.cachedStats) {
    document.getElementById("mainTime").textContent = "Chargement...";
    chrome.runtime.sendMessage({action: "refresh"}, async (res) => {
        if (res && res.status === "success") {
           const newData = await chrome.storage.local.get(['cachedLocations', 'cachedStats', 'cachedFriends', 'giftDays', 'days']);
           Object.assign(data, newData);
           renderEverything(data);
        } else {
           document.getElementById("mainTime").textContent = "Erreur API";
           document.getElementById("ratioTime").textContent = "Vérifie les clés: Options ⚙️";
        }
    });
    return; // renderEverything handled via callback
  }

  renderEverything(data);
}

function renderEverything(data) {
  // --- STATS ---
  if (data.cachedStats) {
    document.getElementById("wallet").textContent = data.cachedStats.wallet !== undefined ? `${data.cachedStats.wallet}₳` : "-";
    document.getElementById("evalPoints").textContent = data.cachedStats.correction_point !== undefined ? data.cachedStats.correction_point : "-";
  }

  // --- LOGTIME CALCULATION ---
  const locs = data.cachedLocations || [];
  let totalMs = 0;
  let todayMs = 0;
  const todayStr = new Date().toDateString();

  const daysCache = {}; // For calendar grid

  locs.forEach(l => {
    const s = new Date(l.begin_at);
    const e = l.end_at ? new Date(l.end_at) : new Date();
    const dur = e - s;
    totalMs += dur;

    if (s.toDateString() === todayStr) {
      todayMs += dur;
    }

    const dateKey = s.getDate();
    if (!daysCache[dateKey]) daysCache[dateKey] = 0;
    daysCache[dateKey] += dur;
  });

  // Render Time
  const th = Math.floor(todayMs / 3600000);
  const tm = Math.floor((todayMs % 3600000) / 60000);
  document.getElementById("todayLogtime").textContent = `${th}h${tm.toString().padStart(2, '0')}`;

  const mh = Math.floor(totalMs / 3600000);
  const mm = Math.floor((totalMs % 3600000) / 60000);
  document.getElementById("mainTime").textContent = `Logtime ${mh}h ${mm.toString().padStart(2, '0')}m`;

  const giftDays = data.giftDays || 0;
  const targetHours = Math.max(0, 154 - (giftDays * 7));
  document.getElementById("ratioTime").textContent = `${mh}h ${mm}m / ${targetHours}h`;

  const pct = Math.min(100, Math.max(0, (mh / targetHours) * 100)) || 0;
  document.getElementById("progressBar").style.width = `${pct}%`;

  // Daily target
  calculateDailyTarget(targetHours, totalMs, data.days);

  // Render Calendar Grid
  renderCalendar(daysCache);

  // Render Friends
  renderFriends(data.cachedFriends || {});

  // Fetch Defenses (Live, via cookie in popup)
  fetchDefenses(data.username);
}

function calculateDailyTarget(targetHours, currentMs, workableDays) {
  const currentHours = currentMs / 3600000.0;
  const remainingHours = targetHours - currentHours;
  const targetLbl = document.getElementById("targetDaily");

  if (remainingHours <= 0) {
    targetLbl.textContent = "Cible: Fini!";
    targetLbl.style.color = "#2ed573";
    return;
  }

  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  let workableCount = 0;

  for (let d = now.getDate() + 1; d <= endOfMonth.getDate(); d++) {
    const tmp = new Date(now.getFullYear(), now.getMonth(), d);
    const dayNameIndex = tmp.getDay();
    if (workableDays && workableDays[`day-${dayNameIndex}`]) {
      workableCount++;
    }
  }

  const dailyAvg = workableCount > 0 ? (remainingHours / workableCount) : remainingHours;
  const dh = Math.floor(dailyAvg);
  const dm = Math.floor((dailyAvg - dh) * 60);

  targetLbl.textContent = `Cible/J: ${dh}h${dm.toString().padStart(2, '0')}`;
  targetLbl.style.color = "#f39c12";
}

function renderCalendar(daysCache) {
  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = "";
  
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  for (let d = 1; d <= daysInMonth; d++) {
    const box = document.createElement("div");
    
    const ms = daysCache[d] || 0;
    const hours = ms / 3600000;

    let classLvl = "cal-lvl-0";
    if (hours > 0 && hours < 2) classLvl = "cal-lvl-1";
    else if (hours >= 2 && hours < 5) classLvl = "cal-lvl-2";
    else if (hours >= 5 && hours < 7) classLvl = "cal-lvl-3";
    else if (hours >= 7 && hours < 9) classLvl = "cal-lvl-4";
    else if (hours >= 9) classLvl = "cal-lvl-5";

    box.className = `cal-day ${classLvl}`;
    
    const num = document.createElement("span");
    num.className = "cal-day-num";
    num.textContent = d.toString();
    box.appendChild(num);

    if (hours > 0) {
      const v = document.createElement("span");
      v.className = "cal-val";
      const hInt = Math.floor(hours);
      const mInt = Math.floor((ms % 3600000) / 60000);
      v.textContent = `${hInt}h${mInt.toString().padStart(2, '0')}`;
      box.appendChild(v);
    }

    grid.appendChild(box);
  }
}

function renderFriends(friendsStats) {
  const box = document.getElementById("friendsBox");
  box.innerHTML = "";
  
  const friendsKeys = Object.keys(friendsStats);
  if (friendsKeys.length === 0) {
    box.innerHTML = `<div class="loading">Aucun ami configuré.</div>`;
    return;
  }

  // Sort by online status
  friendsKeys.sort((a, b) => {
    if (friendsStats[a].active && !friendsStats[b].active) return -1;
    if (!friendsStats[a].active && friendsStats[b].active) return 1;
    return a.localeCompare(b);
  });

  friendsKeys.forEach(login => {
    const f = friendsStats[login];
    let totalMs = 0;
    if (f.locs && Array.isArray(f.locs)) {
      f.locs.forEach(l => {
        totalMs += ((l.end_at ? new Date(l.end_at) : new Date()) - new Date(l.begin_at));
      });
    }

    let fh = Math.floor(totalMs / 3600000);
    let fm = Math.floor((totalMs % 3600000) / 60000);

    const row = document.createElement("div");
    row.className = "friend-row";
    row.onclick = () => { chrome.tabs.create({ url: `https://profile.intra.42.fr/users/${login}` }); };

    const av = document.createElement("div");
    av.className = "friend-avatar";
    if (f.avatar) {
      av.innerHTML = `<img src="${f.avatar}" alt="${login}">`;
    } else {
      av.textContent = login.substring(0,2).toUpperCase();
    }
    
    const info = document.createElement("div");
    info.className = "friend-info";
    info.innerHTML = `<span class="friend-name">${login}</span><span class="friend-logtime">${fh}h ${fm}m</span>`;

    const st = document.createElement("div");
    st.className = "friend-status";
    if (f.active) {
      st.innerHTML = `<div class="status-online">🟢</div><div style="font-size:9px; color:#2ed573;">${f.active}</div>`;
    } else {
      st.innerHTML = `<div class="status-offline">🔴 Off</div>`;
    }

    row.appendChild(av);
    row.appendChild(info);
    row.appendChild(st);
    box.appendChild(row);
  });
}

function fetchDefenses(username) {
  const box = document.getElementById("defensesBox");
  
  // 1. Ask background script for the valid oauth token OR grab the cookie directly via chrome.cookies.
  // Actually, to use chrome.cookies we MUST have `host_permissions: ["*://*.intra.42.fr/*"]`
  // And call:
  chrome.cookies.get({ url: "https://intra.42.fr", name: "_intra_42_session_production" }, async (cookie) => {
    if (!cookie) {
      box.innerHTML = `<div class="defense-item defense-offline">⚠️ Non connecté à l'Intra sur ce navigateur. <br><a href="https://intra.42.fr" target="_blank" style="color:#54a0ff">Se connecter →</a></div>`;
      return;
    }

    // Now get the Token from Background
    chrome.runtime.sendMessage({action: "getToken"}, async (response) => {
      if (!response || !response.token) return;

      try {
        const url = `https://api.intra.42.fr/v2/users/${username}/scale_teams?filter%5Bfuture%5D=true`;
        const res = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${response.token}`,
            // In a Chrome Extension fetch(), if credentials:'include' it should send cookies automatically for the same domain if host permissions allow it, BUT since we fetch from api.intra.42.fr and cookie is on intra.42.fr, we must inject it explicitly.
            'Cookie': `_intra_42_session_production=${cookie.value}`
          }
        });

        if (!res.ok) throw new Error("Erreur res");
        const scales = await res.json();
        
        box.innerHTML = "";
        if (!Array.isArray(scales) || scales.length === 0) {
          box.innerHTML = `<div class="defense-item">Aucune défense prévue</div>`;
          return;
        }

        scales.slice(0, 3).forEach(scale => {
          const date = new Date(scale.begin_at);
          const h = date.getHours().toString().padStart(2, '0');
          const m = date.getMinutes().toString().padStart(2, '0');
          const d = date.getDate().toString().padStart(2, '0');
          const mo = (date.getMonth() + 1).toString().padStart(2, '0');

          const isCorrector = (scale.corrector && scale.corrector.login === username);
          const typeStr = isCorrector ? "💪 Corriger" : "🎓 Être corrigé";
          const dClass = isCorrector ? "defense-corriger" : "defense-corrige";

          let projectName = (scale.scale && scale.scale.name) ? scale.scale.name : "Projet";
          if (scale.team && scale.team.name && projectName === "Projet") projectName = scale.team.name;

          box.innerHTML += `<div class="defense-item ${dClass}">${d}/${mo} à ${h}h${m} - ${typeStr} (${projectName})</div>`;
        });
      } catch (err) {
        box.innerHTML = `<div class="defense-item" style="color:red;">Erreur de chargement. Le cookie a peut-être expiré.</div>`;
      }
    });
  });
}
