const daysNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
let friendsList = [];

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('saveBtn').addEventListener('click', saveOptions);
document.getElementById('addFriendBtn').addEventListener('click', addFriend);

document.getElementById('newFriend').addEventListener('keypress', function(e) {
  if (e.key === 'Enter') addFriend();
});

function initPlanning() {
  const container = document.getElementById('planningDays');
  daysNames.forEach((day, index) => {
    const label = document.createElement('label');
    label.className = 'day-checkbox';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `day-${index}`;
    // Defaults 
    checkbox.checked = (index >= 1 && index <= 5); // Lun-Ven par defaut
    
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(day));
    container.appendChild(label);
  });
}

function renderFriends() {
  const list = document.getElementById('friendsList');
  list.innerHTML = '';
  
  friendsList.forEach((friend, idx) => {
    const li = document.createElement('li');
    li.textContent = friend;
    
    const delBtn = document.createElement('button');
    delBtn.className = 'danger';
    delBtn.textContent = 'Supprimer';
    delBtn.onclick = () => {
      friendsList.splice(idx, 1);
      renderFriends();
    };
    
    li.appendChild(delBtn);
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
  }
}

function saveOptions() {
  const settings = {
    username: document.getElementById('username').value.trim(),
    apiUid: document.getElementById('uid').value.trim(),
    apiSecret: document.getElementById('secret').value.trim(),
    giftDays: parseInt(document.getElementById('giftDays').value) || 0,
    friendsList: friendsList,
    days: {}
  };

  daysNames.forEach((_, index) => {
    settings.days[`day-${index}`] = document.getElementById(`day-${index}`).checked;
  });

  chrome.storage.local.set(settings, () => {
    const status = document.getElementById('statusMessage');
    status.textContent = 'Sauvegarde & Récupération des données...';
    status.classList.add('show');
    
    chrome.runtime.sendMessage({action: "refresh"}, (response) => {
      if (response && response.status === "error") {
        status.textContent = 'Erreur API: Vérifie ton UID/Secret.';
        status.style.color = '#d63031';
      } else {
        status.textContent = 'Paramètres validés et données chargées !';
        status.style.color = '#00b894';
      }
      setTimeout(() => {
        status.classList.remove('show');
      }, 3000);
    });
  });
}

function restoreOptions() {
  initPlanning();
  
  chrome.storage.local.get({
    username: '',
    apiUid: '',
    apiSecret: '',
    giftDays: 0,
    friendsList: [],
    days: {
      'day-0': false, 'day-1': true, 'day-2': true, 'day-3': true,
      'day-4': true, 'day-5': true, 'day-6': false
    }
  }, (items) => {
    document.getElementById('username').value = items.username;
    document.getElementById('uid').value = items.apiUid;
    document.getElementById('secret').value = items.apiSecret;
    document.getElementById('giftDays').value = items.giftDays;
    
    friendsList = items.friendsList;
    renderFriends();
    
    daysNames.forEach((_, index) => {
      document.getElementById(`day-${index}`).checked = items.days[`day-${index}`];
    });
  });
}
