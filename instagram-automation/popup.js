'use strict';

/* =============================================
   popup.js – Instagram Automation Extension
   ============================================= */

const STORAGE_KEY = 'igAutomation';

const DEFAULT_SETTINGS = {
  gsPauseMin: 2,
  gsPauseMax: 3,
  gsRetentionDays: 365,
  tags: [],
  chkFollow: true,
  chkLike: true,
  chkStories: true,
  chkFollowList: true,
  pauseMinutes1: 12,
  pauseMinutes2: 60,
  pauseEvery1: 40,
  pauseEvery2: 200,
  maxFollows: 5000,
  maxStories: 20000,
  serverErrorPause: 5,
  chkRecentOnly: true,
  scanMonths: 24,
  nextTagMinutes: 120,
  nextTagFollows: 200,
  unfollowOnPause: 20,
  unfollowAfterDays: 3,
  followListMax: 500,
  chkFollowListLike: true,
  chkFollowListStories: true,
  followListScrollAttempts: 5,
  unfollowDays: 3,
  chkSkipFollowBack: true,
  maxUnfollowSession: 200,
  maxUnfollowListSession: 200,
  chkUnfollowListSkipFB: false,
};

// ---- State ----
let tags = [];
let activeTab = 0;
let isRunning = false;
let isPaused = false;
let statusPollInterval = null;
let lastLogTimestamp = 0;

// ---- DOM ----
const $ = id => document.getElementById(id);

// ======== INIT ========
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await refreshUnfollowOldStats();
  setupEventListeners();
  startStatusPolling();
});

// ======== Settings ========

async function loadSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const s = { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEY] || {}) };

  applySettingsToDOM(s);

  tags = s.tags || [];
  renderTags();
  updateListStats();

  if (s.automationState?.running) {
    setRunningUI(true, s.automationState.paused || false);
  }
}

function applySettingsToDOM(s) {
  const fields = [
    'gsPauseMin','gsPauseMax','gsRetentionDays',
    'pauseMinutes1','pauseMinutes2','pauseEvery1','pauseEvery2',
    'maxFollows','maxStories','serverErrorPause','scanMonths',
    'nextTagMinutes','nextTagFollows','unfollowOnPause','unfollowAfterDays',
    'followListMax','followListScrollAttempts',
    'unfollowDays','maxUnfollowSession','maxUnfollowListSession',
  ];
  fields.forEach(id => { if ($(id) && s[id] !== undefined) $(id).value = s[id]; });

  const checks = [
    'chkFollow','chkLike','chkStories','chkRecentOnly',
    'chkFollowList','chkFollowListLike','chkFollowListStories',
    'chkSkipFollowBack','chkUnfollowListSkipFB',
  ];
  checks.forEach(id => { if ($(id) && s[id] !== undefined) $(id).checked = s[id]; });
}

async function saveSettings() {
  const existing = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      ...existing,
      gsPauseMin: +$('gsPauseMin').value,
      gsPauseMax: +$('gsPauseMax').value,
      gsRetentionDays: +$('gsRetentionDays').value,
      tags,
      chkFollow: $('chkFollow').checked,
      chkLike: $('chkLike').checked,
      chkStories: $('chkStories').checked,
      chkFollowList: $('chkFollowList').checked,
      pauseMinutes1: +$('pauseMinutes1').value,
      pauseMinutes2: +$('pauseMinutes2').value,
      pauseEvery1: +$('pauseEvery1').value,
      pauseEvery2: +$('pauseEvery2').value,
      maxFollows: +$('maxFollows').value,
      maxStories: +$('maxStories').value,
      serverErrorPause: +$('serverErrorPause').value,
      chkRecentOnly: $('chkRecentOnly').checked,
      scanMonths: +$('scanMonths').value,
      nextTagMinutes: +$('nextTagMinutes').value,
      nextTagFollows: +$('nextTagFollows').value,
      unfollowOnPause: +$('unfollowOnPause').value,
      unfollowAfterDays: +$('unfollowAfterDays').value,
      followListMax: +$('followListMax').value,
      chkFollowListLike: $('chkFollowListLike').checked,
      chkFollowListStories: $('chkFollowListStories').checked,
      followListScrollAttempts: +$('followListScrollAttempts').value,
      unfollowDays: +$('unfollowDays').value,
      chkSkipFollowBack: $('chkSkipFollowBack').checked,
      maxUnfollowSession: +$('maxUnfollowSession').value,
      maxUnfollowListSession: +$('maxUnfollowListSession').value,
      chkUnfollowListSkipFB: $('chkUnfollowListSkipFB').checked,
    }
  });
}

// ======== Event Listeners ========

function setupEventListeners() {
  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      activeTab = +btn.dataset.tab;
      $(`panel-${activeTab}`).classList.add('active');
      if (activeTab === 2) refreshUnfollowOldStats();
    });
  });

  // Tag management
  $('btnAddTag').addEventListener('click', addTag);
  $('tagInput').addEventListener('keydown', e => { if (e.key === 'Enter') addTag(); });

  // Settings toggles (each tab has its own)
  [0, 1, 2, 3].forEach(i => {
    $(`btnToggleSettings${i}`)?.addEventListener('click', () => {
      const panel = $(`settingsPanel${i}`);
      panel.classList.toggle('collapsed');
    });
  });

  // Action buttons
  $('btnRunFollowTag').addEventListener('click',   () => handleRun('followByTag'));
  $('btnRunFollowList').addEventListener('click',  () => handleRun('followFromList'));
  $('btnRunUnfollowOld').addEventListener('click', () => handleRun('unfollowOld'));
  $('btnRunUnfollowList').addEventListener('click',() => handleRun('unfollowFromList'));

  // Pause / Stop
  $('btnPause').addEventListener('click', handlePause);
  $('btnStop').addEventListener('click',  handleStop);

  // Blacklist modal
  $('btnBlacklist').addEventListener('click', openBlacklistModal);
  $('btnCloseModal').addEventListener('click', closeBlacklistModal);
  $('btnCancelBlacklist').addEventListener('click', closeBlacklistModal);
  $('btnSaveBlacklist').addEventListener('click', saveBlacklist);
  $('blacklistModal').addEventListener('click', e => {
    if (e.target === $('blacklistModal')) closeBlacklistModal();
  });
  $('blacklistText').addEventListener('input', updateBlacklistStats);

  // Reset modal
  $('btnReset').addEventListener('click', () => $('resetModal').classList.add('open'));
  $('btnResetLink').addEventListener('click', e => {
    e.preventDefault();
    $('resetModal').classList.add('open');
  });
  $('btnCloseResetModal').addEventListener('click', () => $('resetModal').classList.remove('open'));
  $('btnCancelReset').addEventListener('click', () => $('resetModal').classList.remove('open'));
  $('btnConfirmReset').addEventListener('click', handleResetSettings);

  // Export followed list
  $('btnExportFollowed').addEventListener('click', e => { e.preventDefault(); handleExport(); });

  // Refresh unfollow stats
  $('btnRefreshStats').addEventListener('click', refreshUnfollowOldStats);
  $('unfollowDays').addEventListener('change', refreshUnfollowOldStats);

  // Log clear
  $('btnClearLog').addEventListener('click', () => { $('logContent').innerHTML = ''; });

  // 1-click badge update
  ['chkFollow','chkLike','chkStories'].forEach(id => {
    $(id)?.addEventListener('change', () => { updateOneClickBadge(0); saveSettings(); });
  });
  ['chkFollowList','chkFollowListLike','chkFollowListStories'].forEach(id => {
    $(id)?.addEventListener('change', () => { updateOneClickBadge(1); saveSettings(); });
  });
  updateOneClickBadge(0);
  updateOneClickBadge(1);

  // Auto-save on input change (non-checkbox)
  document.querySelectorAll('input[type="number"], select').forEach(el => {
    el.addEventListener('change', saveSettings);
  });
}

// ======== Tag Management ========

function addTag() {
  const raw = $('tagInput').value.trim();
  if (!raw) return;
  const parts = raw.split(',')
    .map(t => t.trim().replace(/^#/, '').toLowerCase())
    .filter(Boolean);
  let added = 0;
  parts.forEach(tag => {
    if (tag && !tags.includes(tag)) { tags.push(tag); added++; }
  });
  $('tagInput').value = '';
  renderTags();
  if (added > 0) saveSettings();
}

function removeTag(tag) {
  tags = tags.filter(t => t !== tag);
  renderTags();
  saveSettings();
}

function renderTags() {
  const list = $('tagsList');
  list.innerHTML = '';
  tags.forEach((tag, i) => {
    const chip = document.createElement('div');
    chip.className = 'tag-chip' + (i === 0 && isRunning ? ' active-tag' : '');
    chip.innerHTML = `<span>#${tag}</span>
      <button class="tag-chip-remove" title="Remove">×</button>`;
    chip.querySelector('.tag-chip-remove').addEventListener('click', () => removeTag(tag));
    list.appendChild(chip);
  });
}

// ======== Run Actions ========

async function handleRun(mode) {
  if (isRunning) return;
  await saveSettings();

  if (mode === 'followByTag' && tags.length === 0) {
    addLog('Please add at least one tag before running.', 'error');
    return;
  }

  const config = buildConfig();

  // Persist automation state
  const existing = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      ...existing,
      automationState: {
        running: true,
        paused: false,
        mode,
        config,
        tags: mode === 'followByTag' ? [...tags] : [],
        tagIndex: 0,
        listIndex: 0,
        stats: { follows: 0, unfollows: 0, likes: 0, storiesViewed: 0, errors: 0 },
        command: 'start',
        startedAt: Date.now(),
      }
    }
  });

  // Ensure Instagram is open
  let igTab = await getInstagramTab();
  if (!igTab) {
    const url = mode === 'followByTag' && tags.length > 0
      ? `https://www.instagram.com/explore/tags/${tags[0]}/`
      : 'https://www.instagram.com/';
    await chrome.tabs.create({ url });
    await sleep(2500);
    igTab = await getInstagramTab();
  }

  if (igTab) {
    try {
      await chrome.tabs.sendMessage(igTab.id, { action: 'START' });
    } catch (_) { /* content script picks it up via storage on next load */ }
  }

  setRunningUI(true, false);
  addLog(`Started: ${getModeLabel(mode)}`, 'info');
}

async function handlePause() {
  isPaused = !isPaused;
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const stored = data[STORAGE_KEY] || {};
  if (stored.automationState) {
    stored.automationState.command = 'pause';
    stored.automationState.paused = isPaused;
    await chrome.storage.local.set({ [STORAGE_KEY]: stored });
  }
  try {
    const tab = await getInstagramTab();
    if (tab) chrome.tabs.sendMessage(tab.id, { action: 'PAUSE' });
  } catch (_) {}
  setRunningUI(true, isPaused);
  addLog(isPaused ? 'Paused' : 'Resumed', 'warn');
}

async function handleStop() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const stored = data[STORAGE_KEY] || {};
  if (stored.automationState) {
    stored.automationState.command = 'stop';
    stored.automationState.running = false;
    await chrome.storage.local.set({ [STORAGE_KEY]: stored });
  }
  try {
    const tab = await getInstagramTab();
    if (tab) chrome.tabs.sendMessage(tab.id, { action: 'STOP' });
  } catch (_) {}
  setRunningUI(false, false);
  addLog('Stopped', 'warn');
}

// ======== Reset Settings ========

async function handleResetSettings() {
  $('resetModal').classList.remove('open');
  const existing = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
  // Keep user data (followed list, blacklist), only reset settings
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      ...DEFAULT_SETTINGS,
      followedUsers: existing.followedUsers || [],
      blacklist: existing.blacklist || [],
    }
  });
  tags = [...DEFAULT_SETTINGS.tags];
  applySettingsToDOM(DEFAULT_SETTINGS);
  renderTags();
  updateListStats();
  addLog('Settings reset to defaults.', 'info');
}

// ======== Export Following List ========

async function handleExport() {
  const data = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
  const followed = (data.followedUsers || []).filter(u => !u.unfollowedAt).slice(0, 1000);

  if (followed.length === 0) {
    addLog('No followed users to export.', 'warn');
    return;
  }

  const lines = followed.map(u => {
    const date = new Date(u.followedAt).toLocaleDateString();
    return `${u.username}\t${date}`;
  });
  const content = 'Username\tFollowed On\n' + lines.join('\n');
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `instagram_following_${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  addLog(`Exported ${followed.length} followed users.`, 'success');
}

// ======== Status Polling ========

function startStatusPolling() {
  statusPollInterval = setInterval(async () => {
    const data = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    if (!data) return;

    const state = data.automationState;
    const statusMsg = data.lastStatus;

    if (state) {
      if (state.running !== isRunning || state.paused !== isPaused) {
        isRunning = state.running;
        isPaused = state.paused;
        setRunningUI(isRunning, isPaused);
      }
      if (state.stats) updateStatusBar(statusMsg?.text, state.stats);

      // Update tag scanner display
      if (state.tags?.length > 0 && state.tagIndex !== undefined) {
        highlightActiveTag(state.tagIndex);
        const tag = state.tags[state.tagIndex];
        if (tag) {
          $('nextTagDisplay').textContent = `#${tag}`;
          $('nextTagRow').style.display = 'flex';
        }
      }

      // Update log stats line
      if (state.stats) {
        const s = state.stats;
        $('logStatsLine').textContent =
          `👥 ${s.follows} follows · ❌ ${s.unfollows} unfollows · ❤️ ${s.likes} likes · 📖 ${s.storiesViewed} stories`;
      }
    }

    // Show new log entries from content script
    if (statusMsg?.isNew && statusMsg.timestamp > lastLogTimestamp) {
      lastLogTimestamp = statusMsg.timestamp;
      addLog(statusMsg.text, statusMsg.type);
      // Clear isNew flag
      data.lastStatus.isNew = false;
      await chrome.storage.local.set({ [STORAGE_KEY]: data });
    }
  }, 900);
}

// ======== UI Helpers ========

function setRunningUI(running, paused) {
  isRunning = running;
  isPaused = paused;

  // Disable all run buttons while running
  ['btnRunFollowTag','btnRunFollowList','btnRunUnfollowOld','btnRunUnfollowList']
    .forEach(id => { $(id).disabled = running; });

  $('btnPause').disabled = !running;
  $('btnStop').disabled  = !running;

  if (paused) {
    $('btnPause').textContent = '▶ Resume';
    $('btnPause').classList.add('resumed');
  } else {
    $('btnPause').textContent = '⏸ Pause';
    $('btnPause').classList.remove('resumed');
  }

  const dot = $('statusDot');
  dot.className = 'status-dot ' + (running ? (paused ? 'paused' : 'running') : 'idle');

  if (!running) {
    $('statusText').textContent = 'Ready';
    $('statusStats').innerHTML = '';
  }
}

function updateStatusBar(text, stats) {
  if (text) $('statusText').textContent = text;
  if (stats) {
    $('statusStats').innerHTML = `
      <span class="stat-item">👥 <span class="val">${stats.follows || 0}</span></span>
      <span class="stat-item">❌ <span class="val">${stats.unfollows || 0}</span></span>
      <span class="stat-item">❤️ <span class="val">${stats.likes || 0}</span></span>
      <span class="stat-item">📖 <span class="val">${stats.storiesViewed || 0}</span></span>
    `;
  }
}

function highlightActiveTag(index) {
  document.querySelectorAll('.tag-chip').forEach((chip, i) => {
    chip.classList.toggle('active-tag', i === index);
  });
}

function addLog(message, type = 'info') {
  const log = $('logContent');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  const time = new Date().toTimeString().slice(0, 8);
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-msg ${type}">${message}</span>`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 300) log.removeChild(log.firstChild);
}

function updateListStats() {
  const data = (async () => {
    const d = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
    const count = (d.followedUsers || []).filter(u => !u.unfollowedAt).length;
    $('unfollowListStats').textContent = `${count} username${count !== 1 ? 's' : ''} in saved followed list`;
  })();
}

async function refreshUnfollowOldStats() {
  const data = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
  const days = +$('unfollowDays').value || 3;
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const followed = data.followedUsers || [];
  const total = followed.filter(u => !u.unfollowedAt).length;
  const eligible = followed.filter(u => !u.unfollowedAt && u.followedAt < cutoff).length;
  $('totalFollowedCount').textContent = total;
  $('eligibleUnfollowCount').textContent = eligible;
  $('unfollowDaysDisplay').textContent = days;
}

// ======== Blacklist Modal ========

async function openBlacklistModal() {
  const data = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
  const bl = data.blacklist || [];
  $('blacklistText').value = bl.join('\n');
  updateBlacklistStats();
  $('blacklistModal').classList.add('open');
}
function closeBlacklistModal() { $('blacklistModal').classList.remove('open'); }
function updateBlacklistStats() {
  const lines = $('blacklistText').value.split('\n').filter(l => l.trim()).length;
  $('blacklistStats').textContent = `${lines} entr${lines !== 1 ? 'ies' : 'y'}`;
}
async function saveBlacklist() {
  const lines = $('blacklistText').value.split('\n')
    .map(l => l.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
  const data = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
  data.blacklist = lines;
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
  addLog(`Blacklist saved: ${lines.length} entries`, 'info');
  closeBlacklistModal();
}

// ======== Config Builder ========

function buildConfig() {
  return {
    pauseMinSec: +$('gsPauseMin').value,
    pauseMaxSec: +$('gsPauseMax').value,
    retentionDays: +$('gsRetentionDays').value,
    followAccounts: $('chkFollow').checked,
    likePhoto: $('chkLike').checked,
    viewStories: $('chkStories').checked,
    followListEnabled: $('chkFollowList').checked,
    pauseMinutes1: +$('pauseMinutes1').value,
    pauseMinutes2: +$('pauseMinutes2').value,
    pauseEvery1: +$('pauseEvery1').value,
    pauseEvery2: +$('pauseEvery2').value,
    maxFollows: +$('maxFollows').value,
    maxStoriesViews: +$('maxStories').value,
    serverErrorPauseMin: +$('serverErrorPause').value,
    recentOnly: $('chkRecentOnly').checked,
    scanMonths: +$('scanMonths').value,
    nextTagMinutes: +$('nextTagMinutes').value,
    nextTagFollows: +$('nextTagFollows').value,
    unfollowOnPause: +$('unfollowOnPause').value,
    unfollowAfterDays: +$('unfollowAfterDays').value,
    followListMax: +$('followListMax').value,
    followListLike: $('chkFollowListLike').checked,
    followListStories: $('chkFollowListStories').checked,
    followListScrollAttempts: +$('followListScrollAttempts').value,
    unfollowDays: +$('unfollowDays').value,
    skipFollowBack: $('chkSkipFollowBack').checked,
    maxUnfollowSession: +$('maxUnfollowSession').value,
    maxUnfollowListSession: +$('maxUnfollowListSession').value,
    unfollowListSkipFB: $('chkUnfollowListSkipFB').checked,
  };
}

// ======== Helpers ========

function getModeLabel(mode) {
  return {
    followByTag:      'Follow by tag/loc',
    followFromList:   'Click all Follow buttons',
    unfollowOld:      'Unfollow after N days',
    unfollowFromList: 'Unfollow from list',
  }[mode] || mode;
}

async function getInstagramTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
  return tabs.length > 0 ? tabs[0] : null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function updateOneClickBadge(tabIndex) {
  if (tabIndex === 0) {
    const allOn = $('chkFollow')?.checked && $('chkLike')?.checked && $('chkStories')?.checked;
    const badge = $('oneClickBadge0');
    if (badge) badge.classList.toggle('visible', allOn);
  } else if (tabIndex === 1) {
    const allOn = $('chkFollowList')?.checked && $('chkFollowListLike')?.checked && $('chkFollowListStories')?.checked;
    const badge = $('oneClickBadge1');
    if (badge) badge.classList.toggle('visible', allOn);
  }
}
