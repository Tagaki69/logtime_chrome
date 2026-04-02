/**
 * options.js — Options page logic
 * Uses i18n module for translations.
 */
import { t, translatePage } from './modules/i18n.js';

const daysKeys = ['daySunday', 'dayMonday', 'dayTuesday', 'dayWednesday', 'dayThursday', 'dayFriday', 'daySaturday'];
let friendsList = [];
let notifFriends = [];
let refreshTimeout = null;

document.addEventListener('DOMContentLoaded', () => {
  translatePage();
  restoreOptions();
});

document.getElementById('addFriendBtn').addEventListener('click', addFriend);
document.getElementById('btnConnectAPI').addEventListener('click', loginToIntra);

let saveTimeout = null;
document.addEventListener('input', (e) => {
  if (e.target.tagName === 'INPUT') {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveOptions, 500);
  }
});

// For checkboxes, 'change' is still better
document.addEventListener('change', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type === 'checkbox') {
    saveOptions();
  }
});

document.getElementById('newFriend').addEventListener('keypress', function (e) {
  if (e.key === 'Enter') addFriend();
});

function initPlanning() {
  const container = document.getElementById('planningDays');
  daysKeys.forEach((dayKey, index) => {
    const label = document.createElement('label');
    label.className = 'day-checkbox';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `day-${index}`;
    checkbox.checked = (index >= 1 && index <= 5); // Mon-Fri default

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(t(dayKey)));
    container.appendChild(label);
  });
}

function renderFriends() {
  const list = document.getElementById('friendsList');
  list.innerHTML = '';

  friendsList.forEach((friend, idx) => {
    const li = document.createElement('li');

    // Friend name
    const nameSpan = document.createElement('span');
    nameSpan.textContent = friend;
    li.appendChild(nameSpan);

    // Buttons container
    const btnsDiv = document.createElement('div');
    btnsDiv.style.display = 'flex';
    btnsDiv.style.gap = '8px';
    btnsDiv.style.alignItems = 'center';

    // Notification bell toggle
    const bellBtn = document.createElement('button');
    const isNotifEnabled = notifFriends.includes(friend);
    bellBtn.textContent = isNotifEnabled ? '🔔' : '🔕';
    bellBtn.style.fontSize = '16px';
    bellBtn.style.padding = '5px 8px';
    bellBtn.style.background = isNotifEnabled ? '#00b894' : 'var(--border)';
    bellBtn.style.color = isNotifEnabled ? '#fff' : 'var(--text-muted)';
    bellBtn.style.borderRadius = '6px';
    bellBtn.style.cursor = 'pointer';
    bellBtn.style.border = 'none';
    bellBtn.title = isNotifEnabled ? 'Notifications ON' : 'Notifications OFF';
    bellBtn.onclick = (e) => {
      e.stopPropagation();
      if (notifFriends.includes(friend)) {
        notifFriends = notifFriends.filter(f => f !== friend);
      } else {
        notifFriends.push(friend);
      }
      renderFriends();
      saveOptions();
    };
    btnsDiv.appendChild(bellBtn);

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'danger';
    delBtn.textContent = t('optionsDeleteFriend');
    delBtn.onclick = () => {
      friendsList.splice(idx, 1);
      notifFriends = notifFriends.filter(f => f !== friend);
      renderFriends();
      saveOptions();
    };
    btnsDiv.appendChild(delBtn);

    li.appendChild(btnsDiv);
    list.appendChild(li);
  });
}

function addFriend() {
  const input = document.getElementById('newFriend');
  const login = input.value.trim().toLowerCase();

  if (login && !friendsList.includes(login)) {
    friendsList.push(login);
    renderFriends();
    input.value = '';
    saveOptions();
  }
}

async function loginToIntra() {
  const btn = document.getElementById('btnConnectAPI');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('connecting');

  chrome.runtime.sendMessage({ action: 'login' }, (response) => {
    btn.disabled = false;
    btn.textContent = originalText;
    
    if (response && response.status === 'success') {
      btn.textContent = '✅ CONNECTÉ';
      btn.classList.add('connected');
      setTimeout(() => {
        btn.textContent = originalText;
        btn.classList.remove('connected');
      }, 3000);
    } else {
      alert(t('errorOAuth') + ': ' + (response && response.error ? response.error : 'Unknown'));
    }
  });
}

function saveOptions() {
  const settings = {
    giftDays: parseInt(document.getElementById('giftDays').value) || 0,
    freezeDays: parseInt(document.getElementById('freezeDays').value) || 0,
    enableCoalitionTheme: document.getElementById('enableCoalitionTheme').checked,
    enableFriendNotifs: document.getElementById('enableFriendNotifs').checked,
    username: document.getElementById('usernameInput').value.trim(),
    clientId: document.getElementById('clientId').value.trim(),
    clientSecret: document.getElementById('clientSecret').value.trim(),
    friendsList: friendsList,
    notifFriends: notifFriends,
    days: {}
  };

  daysKeys.forEach((_, index) => {
    settings.days[`day-${index}`] = document.getElementById(`day-${index}`).checked;
  });

  // Enable/Disable connect button based on credential completeness
  const btn = document.getElementById('btnConnectAPI');
  btn.disabled = !(settings.username && settings.clientId && settings.clientSecret);

  chrome.storage.local.set(settings, () => {
    const status = document.getElementById('statusMessage');
    status.textContent = t('optionsSaved');
    status.style.color = '#00b894';
    status.classList.add('show');

    if (refreshTimeout) clearTimeout(refreshTimeout);
    refreshTimeout = setTimeout(() => {
      chrome.runtime.sendMessage({ action: "refresh" }, () => {});
    }, 5000); // Reduced to 5s for better responsiveness

    setTimeout(() => {
      status.classList.remove('show');
    }, 2000);
  });
}

function restoreOptions() {
  initPlanning();

  chrome.storage.local.get({
    giftDays: 0,
    freezeDays: 0,
    enableCoalitionTheme: true,
    enableFriendNotifs: false,
    friendsList: [],
    notifFriends: [],
    days: {
      'day-0': false, 'day-1': true, 'day-2': true, 'day-3': true,
      'day-4': true, 'day-5': true, 'day-6': false
    },
    username: '',
    clientId: '',
    clientSecret: ''
  }, (items) => {
    // Show redirect URI
    const redirectUrl = chrome.identity.getRedirectURL();
    document.getElementById('apiHint').textContent = t('optionsAPIHint', [redirectUrl]);

    document.getElementById('usernameInput').value = items.username || '';
    document.getElementById('clientId').value = items.clientId || '';
    document.getElementById('clientSecret').value = items.clientSecret || '';
    document.getElementById('giftDays').value = items.giftDays;
    document.getElementById('freezeDays').value = items.freezeDays;
    document.getElementById('enableCoalitionTheme').checked = items.enableCoalitionTheme;
    document.getElementById('enableFriendNotifs').checked = items.enableFriendNotifs;

    // Enable/Disable connect button
    const btn = document.getElementById('btnConnectAPI');
    btn.disabled = !(items.username && items.clientId && items.clientSecret);

    friendsList = items.friendsList;
    notifFriends = items.notifFriends;
    renderFriends();

    daysKeys.forEach((_, index) => {
      document.getElementById(`day-${index}`).checked = items.days[`day-${index}`];
    });
  });
}
