// background.js

// background.js


chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("refreshData", { periodInMinutes: 5 });
  console.log("Extension Logtime installée. Alarme créée.");

  chrome.storage.local.get(['clusterTimes'], (data) => {
    if (!data.clusterTimes) {
      chrome.storage.local.set({ clusterTimes: {}, lastProcessedLocationId: 0 });
      console.log("Initialisation Matrix (0 postes) terminée.");
    }
  });
});

// Restaurer le badge au démarrage du navigateur
chrome.storage.local.get(['cachedFriends'], (data) => {
  if (data.cachedFriends) {
    let count = 0;
    Object.values(data.cachedFriends).forEach(f => { if (f.active) count++; });
    chrome.action.setBadgeText({ text: count.toString() });
    chrome.action.setBadgeBackgroundColor({ color: count > 0 ? '#00b894' : '#636e72' });
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "refreshData") {
    await refreshAllData();
  }
});

// Listener pour que le popup/options puisse demander un rafraîchissement manuel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "refresh") {
    refreshAllData().then(success => {
      sendResponse({ status: success ? "success" : "error" });
    });
    return true; // async response
  }
  if (request.action === "login") {
    handleLogin().then(res => sendResponse(res));
    return true;
  }
});

async function handleLogin() {
  const { clientId, clientSecret, username } = await chrome.storage.local.get(['clientId', 'clientSecret', 'username']);
  if (!clientId || !clientSecret || !username) {
    return { status: "error", error: "Veuillez configurer votre Login, UID et Secret dans les options." };
  }

  try {
    // 1. Get Access Token via client_credentials
    const res = await fetch('https://api.intra.42.fr/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
      })
    });

    if (!res.ok) throw new Error("Identifiants API invalides (UID/Secret)");
    const data = await res.json();

    const expire = (Date.now() / 1000) + data.expires_in - 60;
    await chrome.storage.local.set({
      accessToken: data.access_token,
      refreshToken: null, // No refresh token in client_credentials
      tokenExpire: expire
    });

    // 2. Initial fetch to validate the target user and get avatar/campus
    const userRes = await fetch(`https://api.intra.42.fr/v2/users/${username}`, {
      headers: { 'Authorization': `Bearer ${data.access_token}` }
    });

    if (userRes.ok) {
      const userData = await userRes.json();
      
      // Store user avatar and campus
      let userAvatar = null;
      if (userData.image && userData.image.versions && userData.image.versions.small) {
        userAvatar = userData.image.versions.small;
      } else if (userData.image && userData.image.link) {
        userAvatar = userData.image.link;
      }

      let campusName = '';
      if (userData.campus && Array.isArray(userData.campus) && userData.campus.length > 0) {
        campusName = userData.campus[0].name || '';
      }

      await chrome.storage.local.set({ userAvatar, userCampus: campusName });
    } else {
      throw new Error(`Utilisateur '${username}' introuvable.`);
    }

    await refreshAllData();
    return { status: "success" };
  } catch (e) {
    console.error("Auth Error:", e);
    return { status: "error", error: e.message };
  }
}

async function getValidToken() {
  const data = await chrome.storage.local.get(['accessToken', 'tokenExpire', 'clientId', 'clientSecret']);
  
  if (data.accessToken && data.tokenExpire > (Date.now() / 1000)) {
    return data.accessToken;
  }

  if (data.clientId && data.clientSecret) {
    try {
      const res = await fetch('https://api.intra.42.fr/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: data.clientId,
          client_secret: data.clientSecret
        })
      });

      if (!res.ok) throw new Error("Auth failed");
      const resData = await res.json();
      const expire = (Date.now() / 1000) + resData.expires_in - 60;
      
      await chrome.storage.local.set({
        accessToken: resData.access_token,
        tokenExpire: expire
      });
      return resData.access_token;
    } catch(e) {
      console.error("Token fetch failed", e);
    }
  }
  
  return null;
}

async function refreshAllData() {
  const currentToken = await getValidToken();
  if (!currentToken) return false;

  const settings = await chrome.storage.local.get(['username', 'friendsList']);
  const username = settings.username;
  if (!username) return false;

  // --- Déterminer la plage de dates ---
  const storageData = await chrome.storage.local.get(['clusterTimes', 'lastProcessedLocationId']);
  let clusterTimes = storageData.clusterTimes || {};
  let lastProcessedLocationId = storageData.lastProcessedLocationId || 0;
  const now = new Date();
  // To keep the profile calendar accurate, we want at least 12 months of data.
  const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  
  // Cache check: see if we have enough history
  const cacheInfo = await chrome.storage.local.get(['cachedLocations', 'lastProcessedLocationId']);
  const cachedLocs = cacheInfo.cachedLocations || [];
  const lastProcessedId = cacheInfo.lastProcessedLocationId || 0;
  
  // Find oldest location in cache
  let oldestDate = now.getTime();
  if (cachedLocs.length > 0) {
    oldestDate = new Date(cachedLocs[cachedLocs.length-1].begin_at).getTime();
  }
  
  // If no cache or oldest location is too recent (e.g. less than 6 months old), we fetch more
  const needsHistory = (oldestDate > new Date(now.getTime() - (180 * 24 * 60 * 60 * 1000)).getTime());
  const isFirstFetch = (lastProcessedId === 0) || needsHistory;

  let startObj;
  if (isFirstFetch) {
    // On remonte sur 1 an si on n'a pas assez d'historique
    startObj = twelveMonthsAgo;
    console.log("🔄 Fetch approfondi Logtime : récupération de 1 an d'historique...");
  } else {
    // Refresh normal : on récupère les 45 derniers jours pour assurer la continuité
    startObj = new Date(now.getTime() - (45 * 24 * 60 * 60 * 1000));
  }
  // Fin : On injecte demain (Now + 24h)
  const endObj = new Date(now.getTime() + 86400000);

  
  const start = startObj.toISOString();
  const end = endObj.toISOString();

  try {
    // 1. Fetch Logtime (paginé si premier fetch, sinon 1 seule page)
    let allLocs = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const locsRes = await fetch(`https://api.intra.42.fr/v2/users/${username}/locations?range[begin_at]=${start},${end}&per_page=100&page=${page}`, {
        headers: { 'Authorization': `Bearer ${currentToken}` }
      });
      if (!locsRes.ok) {
        throw new Error(`Failed to fetch logtime: ${locsRes.status} ${await locsRes.text()}`);
      }
      const pageLocs = await locsRes.json();
      if (Array.isArray(pageLocs) && pageLocs.length > 0) {
        allLocs = allLocs.concat(pageLocs);
        page++;
        if (pageLocs.length < 100) {
          hasMore = false;
        } else {
          await new Promise(r => setTimeout(r, 600)); // Rate limit
        }
      } else {
        hasMore = false;
      }
    }
    const newLocs = allLocs;
    if (isFirstFetch) {
      console.log(`✅ Premier fetch terminé : ${newLocs.length} sessions récupérées sur 1 an.`);
    }

    // --- Merger avec le cache existant pour garder 12 mois de data ---
    let cachedLocations = (await chrome.storage.local.get(['cachedLocations'])).cachedLocations || [];
    
    // Créer une map par ID pour dédoublonner
    const locMap = {};
    cachedLocations.forEach(l => locMap[l.id] = l);
    newLocs.forEach(l => locMap[l.id] = l);
    
    // Re-transformer en tableau et filtrer pour garder seulement les 12 derniers mois
    const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).getTime();
    let mergedLocs = Object.values(locMap).filter(l => {
      const begin = new Date(l.begin_at).getTime();
      return begin >= twelveMonthsAgo;
    });

    // Trier par date décroissante
    mergedLocs.sort((a, b) => new Date(b.begin_at) - new Date(a.begin_at));

    // --- Calculer le résumé mensuel pour le Profile ---
    const monthlyLogtime = {}; // "Jan": minutes
    const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    mergedLocs.forEach(l => {
      const d = new Date(l.begin_at);
      const monthLabel = MONTH_NAMES[d.getMonth()];
      const duration = (l.end_at ? new Date(l.end_at) : new Date()) - new Date(l.begin_at);
      const mins = Math.floor(duration / 60000);
      monthlyLogtime[monthLabel] = (monthlyLogtime[monthLabel] || 0) + mins;
    });
    
    await chrome.storage.local.set({ monthlyLogtime });
    const locs = mergedLocs; 


    // --- Matrix Live Tracking ---
    let activeSession = null;
    let maxId = lastProcessedLocationId;

    if (Array.isArray(locs)) {
      locs.forEach(loc => {
        if (loc.id <= lastProcessedLocationId) return;

        if (loc.end_at !== null) {
          // Session terminée : on ajoute les minutes de façon permanente
          const durationMins = Math.floor((new Date(loc.end_at) - new Date(loc.begin_at)) / 60000);
          clusterTimes[loc.host] = (clusterTimes[loc.host] || 0) + durationMins;
          if (loc.id > maxId) maxId = loc.id;
        } else {
          // Session active
          activeSession = { host: loc.host, begin_at: loc.begin_at };
        }
      });
    }

    // Sleep gently to avoid hitting rate limit
    await new Promise(r => setTimeout(r, 600));
    
    // 2. Fetch Stats
    const statsRes = await fetch(`https://api.intra.42.fr/v2/users/${username}`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (!statsRes.ok) {
      throw new Error(`Failed to fetch stats: ${statsRes.status} ${await statsRes.text()}`);
    }
    const stats = await statsRes.json();
    
    // Store user avatar & campus from stats (so popup always has them)
    if (stats && !stats.error) {
      let userAvatar = null;
      if (stats.image && stats.image.versions && stats.image.versions.small) {
        userAvatar = stats.image.versions.small;
      } else if (stats.image && stats.image.link) {
        userAvatar = stats.image.link;
      }
      let campusName = '';
      if (stats.campus && Array.isArray(stats.campus) && stats.campus.length > 0) {
        campusName = stats.campus[0].name || '';
      }
      await chrome.storage.local.set({ userAvatar, userCampus: campusName });
    }
    // 2bis. Fetch Coalition
    const coalRes = await fetch(`https://api.intra.42.fr/v2/users/${username}/coalitions`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    }).catch(e => null);
    
    let userCoalition = null;
    if (coalRes && coalRes.ok) {
      try {
        const coalData = await coalRes.json();
        if (Array.isArray(coalData) && coalData.length > 0) {
          userCoalition = coalData[0]; // Get primary coalition
        }
      } catch(e) {}
    }

    // --- IMMEDIATE STORAGE OF PERSONAL DATA ---
    // We store this immediately so the Popup can update its main UI 
    // without waiting for the slow friends-refresh loop.
    await chrome.storage.local.set({
      cachedLocations: locs,
      cachedStats: stats && !stats.error ? stats : null,
      cachedCoalition: userCoalition,
      monthlyLogtime: monthlyLogtime,
      lastRefresh: Date.now(),
      clusterTimes: clusterTimes,
      lastProcessedLocationId: maxId,
      activeSession: activeSession
    });

    // Load old cache to fallback if API is rate limited for friends
    const currentCache = await chrome.storage.local.get(['cachedFriends', 'friendAvatars', 'enableFriendNotifs', 'notifFriends']);
    const oldFriendsStats = currentCache.cachedFriends || {};
    const friendAvatars = currentCache.friendAvatars || {};
    const enableNotifs = currentCache.enableFriendNotifs || false;
    const notifFriends = currentCache.notifFriends || [];

    // 3. Update friends online count
    let onlineFriends = 0;
    const friendsStats = {};
    if (settings.friendsList) {
      settings.friendsList.forEach(f => {
        if (oldFriendsStats[f]) friendsStats[f] = oldFriendsStats[f];
      });
    }

    if (settings.friendsList && settings.friendsList.length > 0) {
      for (const friend of settings.friendsList) {
        // Indicate to UI that we are refreshing this specific friend
        friendsStats[friend] = { ...(friendsStats[friend] || {}), refreshing: true };
        await chrome.storage.local.set({ cachedFriends: friendsStats });

        try {
          // Sleep to respect 42 API rate limit
          await new Promise(r => setTimeout(r, 600));

          // Check if we need to re-fetch the friend's profile (avatar)
          const cachedAvatar = friendAvatars[friend];
          const avatarFresh = cachedAvatar && cachedAvatar.fetchedAt && (Date.now() - cachedAvatar.fetchedAt < 86400000); // 24h

          let friendProfilePromise = null;
          if (!avatarFresh) {
            friendProfilePromise = fetch(`https://api.intra.42.fr/v2/users/${friend}`, {
              headers: { 'Authorization': `Bearer ${currentToken}` }
            }).catch(e => null);
          }

          // Friends: we only need the current month's logtime for the popup.
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

          // Always fetch locations for online status + current month logtime
          const friendLocsRes = await fetch(`https://api.intra.42.fr/v2/users/${friend}/locations?range[begin_at]=${monthStart},${end}&per_page=100`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
          }).catch(e => null);


          // Wait for profile only if we launched it
          const friendProfileRes = friendProfilePromise ? await friendProfilePromise : null;

          if (!friendLocsRes || !friendLocsRes.ok) {
            console.warn(`Could not fetch locs for ${friend}, fallback to cache`);
            if (oldFriendsStats[friend]) {
              friendsStats[friend] = oldFriendsStats[friend];
              if (oldFriendsStats[friend].active) onlineFriends++;
            } else {
              delete friendsStats[friend];
            }
            await chrome.storage.local.set({ cachedFriends: friendsStats });
            continue;
          }
          
          const friendLocs = await friendLocsRes.json();
          let friendTotalMs = 0;
          const currentMonth = now.getMonth();
          const currentYear = now.getFullYear();

          if (Array.isArray(friendLocs)) {
            friendLocs.forEach(l => {
              const s = new Date(l.begin_at);
              // Safety filter (redundant with API range but good for crossing boundaries)
              if (s.getMonth() === currentMonth && s.getFullYear() === currentYear) {
                friendTotalMs += ((l.end_at ? new Date(l.end_at) : new Date()) - s);
              }
            });
          }

          const activeFriendSession = Array.isArray(friendLocs) && friendLocs.find(l => l.end_at === null);
          
          // Avatar: use fresh profile data or cache
          let avatarUrl = cachedAvatar ? cachedAvatar.url : null;
          let level = (oldFriendsStats[friend] && oldFriendsStats[friend].level) ? oldFriendsStats[friend].level : 0;
          if (friendProfileRes && friendProfileRes.ok) {
            try {
              const friendProfile = await friendProfileRes.json();
              if (friendProfile && friendProfile.image && friendProfile.image.versions && friendProfile.image.versions.small) {
                avatarUrl = friendProfile.image.versions.small;
              } else if (friendProfile && friendProfile.image && friendProfile.image.link) {
                avatarUrl = friendProfile.image.link;
              }
              // Get level from 42cursus
              if (friendProfile.cursus_users) {
                const cursus = friendProfile.cursus_users.find(cu => cu.cursus.id === 21 || cu.cursus.name === "42cursus");
                if (cursus) level = cursus.level;
              }
              friendAvatars[friend] = { url: avatarUrl, fetchedAt: Date.now() };
            } catch(e) { console.warn("Error parsing profile info", friend); }
          }

          // Detect online transition for notifications
          const wasOffline = !oldFriendsStats[friend] || !oldFriendsStats[friend].active;
          const isNowOnline = !!activeFriendSession;

          friendsStats[friend] = { 
            active: activeFriendSession ? activeFriendSession.host : null, 
            totalMs: friendTotalMs,
            avatar: avatarUrl,
            level: level
          };
          if (activeFriendSession) onlineFriends++;


          // Send notification if friend just came online
          if (wasOffline && isNowOnline && enableNotifs && notifFriends.includes(friend)) {
            try {
              chrome.notifications.create(`friend-online-${friend}-${Date.now()}`, {
                type: "basic",
                iconUrl: avatarUrl || "icon128.png",
                title: chrome.i18n.getMessage("notifTitle") || "42 Logtime",
                message: chrome.i18n.getMessage("notifFriendOnline", [friend, activeFriendSession.host]) || `${friend} just connected!`
              });
            } catch(notifErr) {
              console.warn("Failed to send notification for", friend, notifErr);
            }
          }

          await chrome.storage.local.set({ cachedFriends: friendsStats });
        } catch(e) { 
          console.warn("Error API friend", friend); 
          if (oldFriendsStats[friend]) {
             friendsStats[friend] = oldFriendsStats[friend];
             if (oldFriendsStats[friend].active) onlineFriends++;
          } else {
             delete friendsStats[friend];
          }
          await chrome.storage.local.set({ cachedFriends: friendsStats });
        }
      }
    }

    // Update badge with number of online friends
    if (onlineFriends > 0) {
      chrome.action.setBadgeText({ text: onlineFriends.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#00b894' });
    } else {
      chrome.action.setBadgeText({ text: '0' });
      chrome.action.setBadgeBackgroundColor({ color: '#636e72' });
    }

    // Final Sync of all data
    await chrome.storage.local.set({
      cachedFriends: friendsStats,
      friendAvatars: friendAvatars
    });


    return true;

  } catch (err) {
    console.error("Erreur lors du refresh:", err);
    return false;
  }
}
