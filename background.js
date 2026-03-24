// background.js

let token = null;
let tokenExpire = 0;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("refreshData", { periodInMinutes: 5 });
  console.log("Extension Logtime installée. Alarme créée.");
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
  if (request.action === "getToken") {
    getValidToken().then(t => sendResponse({token: t}));
    return true;
  }
});

async function getValidToken() {
  if (token && tokenExpire > (Date.now() / 1000)) {
    return token;
  }

  const settings = await chrome.storage.local.get(['apiUid', 'apiSecret']);
  if (!settings.apiUid || !settings.apiSecret) {
    console.warn("UID ou Secret manquant.");
    return null;
  }

  try {
    const res = await fetch('https://api.intra.42.fr/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: settings.apiUid,
        client_secret: settings.apiSecret
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Token API Error Status:", res.status, errText);
      return null;
    }

    const data = await res.json();
    if (data.access_token) {
      token = data.access_token;
      tokenExpire = (Date.now() / 1000) + data.expires_in - 60; // 1 min margin
      return token;
    } else {
      console.error("Token API Error:", data);
    }
  } catch (error) {
    console.error("Erreur de récupération du token:", error);
  }
  return null;
}

async function refreshAllData() {
  const currentToken = await getValidToken();
  if (!currentToken) return false;

  const settings = await chrome.storage.local.get(['username', 'friendsList']);
  const username = settings.username;
  if (!username) return false;

  const now = new Date();
  const startObj = new Date(now.getFullYear(), now.getMonth(), 1);
  const endObj = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  
  // Format for Intra API
  // Using simplified strings
  const start = startObj.toISOString();
  const end = endObj.toISOString();

  try {
    // 1. Fetch Logtime
    const locsRes = await fetch(`https://api.intra.42.fr/v2/users/${username}/locations?range[begin_at]=${start},${end}&per_page=100`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (!locsRes.ok) {
      throw new Error(`Failed to fetch logtime: ${locsRes.status} ${await locsRes.text()}`);
    }
    const locs = await locsRes.json();

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
    
    // Load old cache to fallback if API is rate limited
    const currentCache = await chrome.storage.local.get(['cachedFriends']);
    const oldFriendsStats = currentCache.cachedFriends || {};

    // 3. Update friends online count
    let onlineFriends = 0;
    const friendsStats = {};

    if (settings.friendsList && settings.friendsList.length > 0) {
      for (const friend of settings.friendsList) {
        try {
          // Sleep to respect 42 API rate limit (~2 req/s max)
          await new Promise(r => setTimeout(r, 600));

          const friendLocsRes = await fetch(`https://api.intra.42.fr/v2/users/${friend}/locations?range[begin_at]=${start},${end}&per_page=100`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
          });
          if (!friendLocsRes.ok) {
            console.warn(`Could not fetch locs for ${friend}, fallback to cache`);
            if (oldFriendsStats[friend]) {
              friendsStats[friend] = oldFriendsStats[friend];
              if (oldFriendsStats[friend].active) onlineFriends++;
            }
            continue;
          }
          const friendLocs = await friendLocsRes.json();
          const activeSession = Array.isArray(friendLocs) && friendLocs.find(l => l.end_at === null);
          
          // Récupération du profil de l'ami (pour la photo)
          let avatarUrl = null;
          try {
            await new Promise(r => setTimeout(r, 600)); // Another sleep before the second request
            const friendProfileRes = await fetch(`https://api.intra.42.fr/v2/users/${friend}`, {
              headers: { 'Authorization': `Bearer ${currentToken}` }
            });
            if (!friendProfileRes.ok) {
              console.warn(`Could not fetch profile for ${friend}: ${friendProfileRes.status} ${await friendProfileRes.text()}`);
            } else {
              const friendProfile = await friendProfileRes.json();
              if (friendProfile && friendProfile.image && friendProfile.image.versions && friendProfile.image.versions.small) {
                avatarUrl = friendProfile.image.versions.small;
              } else if (friendProfile && friendProfile.image && friendProfile.image.link) {
                avatarUrl = friendProfile.image.link;
              }
            }
          } catch(e) { console.warn("Error fetching friend profile info", friend); }

          friendsStats[friend] = { 
            active: activeSession ? activeSession.host : null, 
            locs: friendLocs,
            avatar: avatarUrl 
          };
          if (activeSession) onlineFriends++;
        } catch(e) { 
          console.warn("Error API friend", friend); 
          if (oldFriendsStats[friend]) {
             friendsStats[friend] = oldFriendsStats[friend];
             if (oldFriendsStats[friend].active) onlineFriends++;
          }
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
      cachedFriends: friendsStats,
      lastRefresh: Date.now()
    });

    return true;

  } catch (err) {
    console.error("Erreur lors du refresh:", err);
    return false;
  }
}
