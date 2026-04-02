/**
 * stats.js — Stats rendering module
 * Handles wallet, eval points, blackhole, XP level, project tracker,
 * logtime calculation and daily target.
 */
import { t } from './i18n.js';

/**
 * Renders the user stats section (wallet, eval, blackhole, level, project).
 * @param {Object} cachedStats - The raw stats object from the API
 * @param {number} freezeDays - Additional freeze days configured by the user
 */
export function renderStats(cachedStats, freezeDays) {
  if (!cachedStats) return;

  // Wallet & Eval
  document.getElementById("wallet").textContent =
    cachedStats.wallet !== undefined ? `${cachedStats.wallet}₳` : "-";
  document.getElementById("evalPoints").textContent =
    cachedStats.correction_point !== undefined ? cachedStats.correction_point : "-";

  // Cursus (42 main = id 21)
  let cursus = null;
  if (cachedStats.cursus_users) {
    cursus = cachedStats.cursus_users.find(c => c.cursus_id === 21)
          || cachedStats.cursus_users.find(c => c.blackholed_at !== null);
  }

  // Blackhole
  const bhElem = document.getElementById("blackholeDate");
  if (cursus && cursus.blackholed_at) {
    const bhDate = new Date(cursus.blackholed_at);
    if (freezeDays) {
      bhDate.setDate(bhDate.getDate() + parseInt(freezeDays));
    }
    const day = bhDate.getDate();
    const monthStr = bhDate.toLocaleDateString(undefined, { month: 'short' });
    const yearStr = bhDate.getFullYear().toString().slice(-2);
    bhElem.textContent = `${day} ${monthStr} ${yearStr}`;
    bhElem.style.color = "#e94560";
  } else {
    bhElem.textContent = t("blackholeSafe");
    bhElem.style.color = "#2ed573";
  }

  // XP Level
  if (cursus) {
    const level = cursus.level;
    const lvlInt = Math.floor(level);
    const percent = Math.round((level - lvlInt) * 100);
    document.getElementById("levelContainer").style.display = "block";
    document.getElementById("levelText").textContent = `Level ${lvlInt} - ${percent}%`;
    document.getElementById("levelFill").style.width = "0%";
    setTimeout(() => {
      document.getElementById("levelFill").style.width = `${percent}%`;
    }, 50);
  }

  // Current project
  if (cachedStats.projects_users) {
    const inProgress = cachedStats.projects_users.find(p => p.status === "in_progress");
    if (inProgress) {
      document.getElementById("projectTracker").style.display = "block";
      document.getElementById("currentProjectName").textContent = inProgress.project.name;
      const createdOn = new Date(inProgress.created_at);
      const diffDays = Math.floor((new Date() - createdOn) / (1000 * 60 * 60 * 24));
      document.getElementById("currentProjectDuration").textContent =
        t("sinceDay", [diffDays.toString(), diffDays > 1 ? 's' : '']);
    } else {
      document.getElementById("projectTracker").style.display = "none";
    }
  }
}

/**
 * Calculates logtime from raw location data.
 * @param {Array} locations - Array of location objects ({ begin_at, end_at })
 * @returns {{ totalMs: number, todayMs: number, daysCache: Object }}
 */
export function calculateLogtime(locations) {
  let totalMs = 0;
  let todayMs = 0;
  const todayStr = new Date().toDateString();
  const daysCache = {};

  (locations || []).forEach(l => {
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

  return { totalMs, todayMs, daysCache };
}

/**
 * Renders the logtime display in the header.
 * @param {number} totalMs - Total logtime in milliseconds
 * @param {number} todayMs - Today's logtime in milliseconds
 * @param {number} giftDays - Number of gift days
 * @returns {number} targetHours for downstream usage
 */
export function renderLogtime(totalMs, todayMs, giftDays) {
  const th = Math.floor(todayMs / 3600000);
  const tm = Math.floor((todayMs % 3600000) / 60000);
  document.getElementById("todayLogtime").textContent = `${th}h${tm.toString().padStart(2, '0')}`;

  const mh = Math.floor(totalMs / 3600000);
  const mm = Math.floor((totalMs % 3600000) / 60000);
  document.getElementById("mainTime").textContent = `Logtime ${mh}h ${mm.toString().padStart(2, '0')}m`;

  const targetHours = Math.max(0, 154 - ((giftDays || 0) * 7));
  document.getElementById("ratioTime").textContent = `${mh}h ${mm}m / ${targetHours}h`;

  const pct = Math.min(100, Math.max(0, (mh / targetHours) * 100)) || 0;
  document.getElementById("progressBar").style.width = "0%";
  setTimeout(() => {
    document.getElementById("progressBar").style.width = `${pct}%`;
  }, 50);

  return targetHours;
}

/**
 * Calculates and displays the daily target.
 * @param {number} targetHours - Monthly target hours
 * @param {number} currentMs - Total logtime done this month (ms)
 * @param {Object} workableDays - Map of day-index → boolean
 */
export function calculateDailyTarget(targetHours, currentMs, workableDays) {
  const currentHours = currentMs / 3600000.0;
  const remainingHours = targetHours - currentHours;
  const targetLbl = document.getElementById("targetDaily");

  if (remainingHours <= 0) {
    targetLbl.textContent = t("dailyTargetDone");
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

  targetLbl.textContent = `${t("dailyTargetPrefix")} ${dh}h${dm.toString().padStart(2, '0')}`;
  targetLbl.style.color = "#f39c12";
}
