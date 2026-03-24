# 42 Logtime Dashboard - Chrome Extension 🚀

Une extension Chrome ultra-rapide pour suivre en temps réel ton **Logtime**, ton **Wallet**, tes **évaluations**, et voir si **tes amis sont présents au cluster**.

![Logo](icon128.png)

---

## ✨ Fonctionnalités

- **🕒 Logtime :** Compteur précis, ratio mensuel et gestion des "Gift days".
- **🤝 Amis :** Statut en ligne/hors-ligne, logtime et photos de profil (Avatars) récupérés en direct !
- **🎯 Objectif mensuel :** Configure tes jours ouvrés pour calculer précisément la charge de travail (Cible/Jour).
- **🛡️ Défenses :** Liste de tes prochaines évaluations, synchronisée de manière totalement transparente via les cookies natifs de Chrome (plus besoin de script Selenium complexe !).
- **📊 Graphique Calendrier (Heatmap) :** Un calendrier thermique affichant ta productivité passée pendant le mois en cours.

---

## ⚡ Installation (Mode Développeur)

Puisque cette extension est pour l'instant configurée en mode non-empaqueté (developer mode), suis ces étapes :

1. Ouvre Chrome (ou Brave/Edge).
2. Va dans tes extensions : `chrome://extensions/`
3. Active le **Mode développeur** (interrupteur en haut à droite).
4. Clique sur **Charger l'extension non empaquetée** (Load unpacked).
5. Sélectionne ce dossier `chrome_extension`.
6. L'extension "42 Logtime Dashboard" apparaîtra dans ta liste avec son icône. N'hésite pas à l'épingler à ta barre de tâches !

---

## 🔑 Configuration & API 42

Pour que l'extension puisse récupérer tes informations au réseau 42, tu dois lui fournir une application OAuth :

1. Rends-toi sur 👉 [https://profile.intra.42.fr/oauth/applications/new](https://profile.intra.42.fr/oauth/applications/new)
2. Remplis le formulaire comme ceci :
   - **Name :** Chrome Logtime Dashboard
   - **Redirect URI :** `http://localhost`
   - **Scopes :** Coche uniquement `public`
3. Clique sur Submit.
4. Fais un **Clic-droit** sur l'icône de l'extension -> Clique sur **Options**.
5. Rentre ton **Login**, l'**UID** (Client ID) et le **Secret** que tu viens de générer.
6. Clique sur **Sauvegarder les paramètres** (Le badge "Paramètres validés" en vert certifiera que tes clés fonctionnent !).

---

## 🔒 Sécurité
- **Toutes tes données (clés, etc) sont stockées dans le cache local sécurisé de ton navigateur (`chrome.storage.local`).**
- Contrairement à la version GNOME tierce, ton authentification vers l'Intra se fait silencieusement et de façon native. AUCUN outil tiers n'enregistre ton cookie `_intra_42_session_production`, l'extension utilise uniquement ton compte Google Chrome actif.

*(Créée par [elarue] / Convertie pour Google Chrome)*
