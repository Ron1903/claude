'use strict';

/* =============================================
   background.js – Service Worker
   Instagram Automation Extension
   ============================================= */

const STORAGE_KEY = 'igAutomation';

// ---- Handle messages from popup ----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'GET_INSTAGRAM_TAB') {
    chrome.tabs.query({ url: 'https://www.instagram.com/*' }, tabs => {
      sendResponse(tabs.length > 0 ? tabs[0] : null);
    });
    return true; // async
  }

  if (message.action === 'OPEN_INSTAGRAM') {
    openInstagramTab(message.url).then(tabId => sendResponse({ tabId }));
    return true;
  }

  if (message.action === 'RELAY_TO_CONTENT') {
    // Forward message to Instagram tab
    chrome.tabs.query({ url: 'https://www.instagram.com/*' }, tabs => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, message.payload, response => {
          sendResponse(response);
        });
      } else {
        sendResponse({ error: 'No Instagram tab found' });
      }
    });
    return true;
  }
});

// ---- Open / focus Instagram tab ----
async function openInstagramTab(url) {
  const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { url: url || tabs[0].url, active: true });
    return tabs[0].id;
  } else {
    const tab = await chrome.tabs.create({ url: url || 'https://www.instagram.com/' });
    return tab.id;
  }
}

// ---- Clean up old followed-user records ----
async function cleanupOldRecords() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const stored = data[STORAGE_KEY];
  if (!stored) return;

  const retentionDays = stored.gsRetentionDays || 365;
  const cutoff = Date.now() - retentionDays * 24 * 3600 * 1000;

  if (stored.followedUsers && stored.followedUsers.length > 0) {
    const cleaned = stored.followedUsers.filter(u => {
      // Keep if: not unfollowed OR unfollowed recently
      if (!u.unfollowedAt) return true;
      return u.unfollowedAt > cutoff;
    });

    if (cleaned.length !== stored.followedUsers.length) {
      stored.followedUsers = cleaned;
      await chrome.storage.local.set({ [STORAGE_KEY]: stored });
      console.log(`[IG Bot] Cleaned ${stored.followedUsers.length - cleaned.length} old records`);
    }
  }
}

// ---- Daily cleanup alarm ----
chrome.alarms.create('dailyCleanup', {
  periodInMinutes: 60 * 24, // every 24 hours
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'dailyCleanup') {
    cleanupOldRecords();
  }
});

// Run cleanup on startup
cleanupOldRecords();
