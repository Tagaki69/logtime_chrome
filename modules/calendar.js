/**
 * calendar.js — Calendar heatmap rendering module
 */

/**
 * Renders the monthly heatmap calendar grid.
 * @param {Object} daysCache - Map of day-of-month → milliseconds of logtime
 */
export function renderCalendar(daysCache) {
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

    const hInt = Math.floor(hours);
    const mInt = Math.floor((ms % 3600000) / 60000);
    const monthStr = now.toLocaleDateString(undefined, { month: 'short' });
    box.setAttribute("data-tooltip", `${d} ${monthStr} : ${hInt}h${mInt.toString().padStart(2, '0')}`);

    const num = document.createElement("span");
    num.className = "cal-day-num";
    num.textContent = d.toString();
    box.appendChild(num);

    if (hours > 0) {
      const v = document.createElement("span");
      v.className = "cal-val";
      v.textContent = `${hInt}h${mInt.toString().padStart(2, '0')}`;
      box.appendChild(v);
    }

    grid.appendChild(box);
  }
}
