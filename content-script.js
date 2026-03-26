// content-script.js

// Seuils en minutes
const THRESHOLDS = {
    GREEN: 222,  // >= 3h42
    BLUE: 162,   // 2h42 -> 3h41
    ORANGE: 102, // 1h42 -> 2h41
    RED: 0       // 0 -> 1h41
};

// Toujours afficher le temps réel
function minutesToHoursMinutes(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h${m.toString().padStart(2, '0')}`;
}

// Couleurs par seuil
function getColorThemeForMinutes(mins, isClaimed) {
    if (isClaimed) return { bgColor: '#eab308', borderColor: '#854d0e', shadowColor: 'rgba(234, 179, 8, 0.5)', text: 'CLAIMED' };
    if (mins >= THRESHOLDS.GREEN) return { bgColor: '#22c55e', borderColor: '#14532d', shadowColor: 'rgba(34, 197, 94, 0.5)' };
    if (mins >= THRESHOLDS.BLUE) return { bgColor: '#3b82f6', borderColor: '#1e3a8a', shadowColor: 'rgba(59, 130, 246, 0.5)' };
    if (mins >= THRESHOLDS.ORANGE) return { bgColor: '#f97316', borderColor: '#7c2d12', shadowColor: 'rgba(249, 115, 22, 0.5)' };
    if (mins > 0) return { bgColor: '#ef4444', borderColor: '#7f1d1d', shadowColor: 'rgba(239, 68, 68, 0.5)' };
    return null;
}

function generateCSS(clusterTimes, activeSession) {
    let cssString = '';

    const activeHost = activeSession ? activeSession.host : null;
    const activeStart = activeSession ? new Date(activeSession.begin_at) : null;

    for (const [host, baseMins] of Object.entries(clusterTimes)) {
        let totalMins = baseMins;

        if (host === activeHost && activeStart) {
            const liveDiff = Math.floor((new Date() - activeStart) / 60000);
            totalMins += liveDiff;
        }

        if (totalMins <= 0) continue;

        const isClaimed = window.claimedHosts && window.claimedHosts.includes(host);
        const theme = getColorThemeForMinutes(totalMins, isClaimed);
        if (!theme) continue;

        const text = isClaimed ? theme.text : minutesToHoursMinutes(totalMins);

        cssString += `
            #host-${host} {
                opacity: 1 !important; transform: scale(1.1) !important; z-index: 50 !important;
                box-shadow: 0 10px 25px -5px ${theme.shadowColor} !important; position: relative !important;
            }
            #${host} > div > div > div { background-color: ${theme.bgColor} !important; border: 2px solid ${theme.borderColor} !important; }
            #${host} p { color: #ffffff !important; font-weight: 800 !important; }
            #${host} svg { color: #ffffff !important; }
            #host-${host}::after {
                content: "${text}"; position: absolute; top: 43px; left: 50%; transform: translateX(-50%); 
                background-color: #111827; color: #ffffff; font-size: 11px; font-weight: 900;
                padding: 3px 8px; border-radius: 4px; white-space: nowrap; z-index: 100 !important;
                border: 1px solid ${theme.bgColor}; pointer-events: none;
            }
        `;
    }
    return cssString;
}

function injectOrUpdateCSS(clusterTimes, activeSession) {
    let styleEl = document.getElementById('logtime42-matrix-styles');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'logtime42-matrix-styles';
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = generateCSS(clusterTimes, activeSession);
}

// Initialisation
let currentClusterTimes = {};
let currentActiveSession = null;
let renderTimeout = null;
window.claimedHosts = [];

async function fetchMyClaims() {
    try {
        const res = await fetch("https://matrix.42lyon.fr/claimed");
        if (res.ok) {
            const html = await res.text();
            // Scraping simple : on vérifie pour chaque poste si la chaine de caractères existe
            // dans la page des claims (qui ne liste que les claims de l'utilisateur).
            let hostsFound = [];
            for (const host of Object.keys(currentClusterTimes)) {
                if (html.includes(host)) {
                    hostsFound.push(host);
                }
            }
            window.claimedHosts = hostsFound;
            render();
        }
    } catch(err) {
        console.error("Logtime42: Impossible de récupérer les claims :", err);
    }
}

function render() {
    injectOrUpdateCSS(currentClusterTimes, currentActiveSession);
}

// Debounce pour éviter de re-render trop souvent lors des mutations DOM
function debouncedRender() {
    if (renderTimeout) clearTimeout(renderTimeout);
    renderTimeout = setTimeout(render, 300);
}

// Attendre que la page SvelteKit soit complètement rendue
function waitForMatrixAndRender() {
    // Observer les mutations du DOM pour détecter quand SvelteKit a fini de render
    const observer = new MutationObserver(() => {
        // Chaque fois que le DOM change, on re-render (les rotate-y-180 arrivent dynamiquement)
        debouncedRender();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'] // Surveiller les changements de classe (rotate-y-180)
    });

    // Render initial après un délai pour laisser SvelteKit hydrater
    setTimeout(render, 2000);
    // Re-render de sécurité au cas où le premier était trop tôt
    setTimeout(render, 5000);

    // Live updater chaque minute pour le temps en cours
    setInterval(render, 60000);
    
    // Refresh claims periodically
    setInterval(fetchMyClaims, 120000);
}

// Chargement initial depuis le Storage
chrome.storage.local.get(['clusterTimes', 'activeSession'], (data) => {
    currentClusterTimes = data.clusterTimes || {};
    currentActiveSession = data.activeSession || null;
    fetchMyClaims();
    waitForMatrixAndRender();
});

// Écoute des updates depuis background.js
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        let changed = false;
        if (changes.clusterTimes) {
            currentClusterTimes = changes.clusterTimes.newValue || {};
            changed = true;
        }
        if (changes.activeSession) {
            currentActiveSession = changes.activeSession.newValue || null;
            changed = true;
        }
        if (changed) render();
    }
});

console.log("%c✅ Logtime42 Matrix Tracker chargé !", "color: #22c55e; font-size: 14px;");
