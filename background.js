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
  const { clientId, clientSecret } = await chrome.storage.local.get(['clientId', 'clientSecret']);
  if (!clientId || !clientSecret) {
    return { status: "error", error: "Veuillez configurer votre UID et Secret dans les options de l'extension." };
  }

  const redirectUrl = chrome.identity.getRedirectURL();
  const authUrl = `https://api.intra.42.fr/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUrl)}&response_type=code&scope=public`;

  return new Promise((resolve) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      async (callbackUrl) => {
        if (chrome.runtime.lastError || !callbackUrl) {
          console.error("Auth Error:", chrome.runtime.lastError);
          resolve({ status: "error", error: chrome.runtime.lastError ? chrome.runtime.lastError.message : "Auth cancelled" });
          return;
        }

        const urlParams = new URLSearchParams(new URL(callbackUrl).search);
        const code = urlParams.get("code");

        if (!code) {
          resolve({ status: "error", error: "No code returned" });
          return;
        }

        try {
          const res = await fetch('https://api.intra.42.fr/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              grant_type: 'authorization_code',
              client_id: clientId,
              client_secret: clientSecret,
              code: code,
              redirect_uri: redirectUrl
            })
          });

          if (!res.ok) throw new Error("Failed to exchange code for token: " + await res.text());
          const data = await res.json();

          const expire = (Date.now() / 1000) + data.expires_in - 60;
          await chrome.storage.local.set({
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            tokenExpire: expire
          });

          // Retrieve the target login: from storage (manual) or from /v2/me (auto)
          const localSettings = await chrome.storage.local.get(['username']);
          let targetLogin = localSettings.username;
          let userAvatar = null;
          let campusName = '';

          // Fetch the /v2/me profile of the AUTHENTICATED user to get avatar/campus
          // (Even if we use a different username for logtime, we fetch the current token's owner info)
          try {
            const meRes = await fetch('https://api.intra.42.fr/v2/me', {
              headers: { 'Authorization': `Bearer ${data.access_token}` }
            });
            if (meRes.ok) {
              const meData = await meRes.json();
              
              // If no manual username, use the one from Intra
              if (!targetLogin || targetLogin.trim() === "") {
                targetLogin = meData.login;
                await chrome.storage.local.set({ username: targetLogin });
              }

              // Extract avatar and campus from the token owner
              if (meData.image && meData.image.versions && meData.image.versions.small) {
                userAvatar = meData.image.versions.small;
              } else if (meData.image && meData.image.link) {
                userAvatar = meData.image.link;
              }
              if (meData.campus && Array.isArray(meData.campus) && meData.campus.length > 0) {
                campusName = meData.campus[0].name || '';
              }
              
              await chrome.storage.local.set({ userAvatar, userCampus: campusName });
            }
          } catch (meErr) {
            console.error("Failed to fetch /v2/me during login:", meErr);
          }

          await refreshAllData();
          resolve({ status: "success" });
        } catch (e) {
          console.error("OAuth Error:", e);
          resolve({ status: "error", error: e.message });
        }
      }
    );
  });
}

async function getValidToken() {
  const data = await chrome.storage.local.get(['accessToken', 'refreshToken', 'tokenExpire']);
  
  if (data.accessToken && data.tokenExpire > (Date.now() / 1000)) {
    return data.accessToken;
  }

  if (data.refreshToken) {
    const { clientId, clientSecret } = await chrome.storage.local.get(['clientId', 'clientSecret']);
    if (!clientId || !clientSecret) return null;

    try {
      const res = await fetch('https://api.intra.42.fr/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: data.refreshToken
        })
      });

      if (res.ok) {
        const tokenData = await res.json();
        const expire = (Date.now() / 1000) + tokenData.expires_in - 60;
        await chrome.storage.local.set({
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          tokenExpire: expire
        });
        return tokenData.access_token;
      } else {
        console.warn("Refresh token failed, user must log in again.");
        // We could clear auth data here
      }
    } catch(e) {
      console.error("Token refresh request failed", e);
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
  const isFirstFetch = (lastProcessedLocationId === 0);

  const now = new Date();
  let startObj;
  if (isFirstFetch) {
    // Premier lancement : on remonte sur 1 an
    startObj = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    console.log("🔄 Premier fetch Matrix : récupération de 1 an d'historique...");
  } else {
    // Refresh normal : juste le mois en cours
    startObj = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  // Fin : On injecte demain (Now + 24h) pour s'assurer d'inclure toutes les sessions débutées aujourd'hui
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
    const locs = allLocs;
    if (isFirstFetch) {
      console.log(`✅ Premier fetch terminé : ${locs.length} sessions récupérées sur 1 an.`);
    }

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

    // Load old cache to fallback if API is rate limited
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

          // Always fetch locations for online status
          const friendLocsRes = await fetch(`https://api.intra.42.fr/v2/users/${friend}/locations?range[begin_at]=${start},${end}&per_page=100`, {
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
          if (Array.isArray(friendLocs)) {
            friendLocs.forEach(l => {
              friendTotalMs += ((l.end_at ? new Date(l.end_at) : new Date()) - new Date(l.begin_at));
            });
          }
          const activeFriendSession = Array.isArray(friendLocs) && friendLocs.find(l => l.end_at === null);
          
          // Avatar: use fresh profile data or cache
          let avatarUrl = cachedAvatar ? cachedAvatar.url : null;
          if (friendProfileRes && friendProfileRes.ok) {
            try {
              const friendProfile = await friendProfileRes.json();
              if (friendProfile && friendProfile.image && friendProfile.image.versions && friendProfile.image.versions.small) {
                avatarUrl = friendProfile.image.versions.small;
              } else if (friendProfile && friendProfile.image && friendProfile.image.link) {
                avatarUrl = friendProfile.image.link;
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
            avatar: avatarUrl 
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

    // Cache everything
    await chrome.storage.local.set({
      cachedLocations: Array.isArray(locs) ? locs : [],
      cachedStats: stats && !stats.error ? stats : null,
      cachedCoalition: userCoalition,
      cachedFriends: friendsStats,
      friendAvatars: friendAvatars,
      lastRefresh: Date.now(),
      clusterTimes: clusterTimes,
      lastProcessedLocationId: maxId,
      activeSession: activeSession
    });

    return true;

  } catch (err) {
    console.error("Erreur lors du refresh:", err);
    return false;
  }
}
