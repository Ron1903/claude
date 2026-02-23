'use strict';

/* =============================================
   popup.js – Instagram Automation Extension
   ============================================= */

const STORAGE_KEY = 'igAutomation';

// ---- State ----
let tags = [];
let activeTab = 0;
let isRunning = false;
let isPaused = false;
let statusPollInterval = null;

// ---- DOM refs ----
const $ = id => document.getElementById(id);

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await refreshUnfollowOldStats();
  setupEventListeners();
  startStatusPolling();
});

// ======== Settings persistence ========

async function loadSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const s = data[STORAGE_KEY] || {};

  // Global
  if (s.gsPauseMin !== undefined) $('gsPauseMin').value = s.gsPauseMin;
  if (s.gsPauseMax !== undefined) $('gsPauseMax').value = s.gsPauseMax;
  if (s.gsRetentionDays !== undefined) $('gsRetentionDays').value = s.gsRetentionDays;

  // Tags
  tags = s.tags || [];
  renderTags();

  // Tab 0 settings
  if (s.chkFollow !== undefined) $('chkFollow').checked = s.chkFollow;
  if (s.chkLike !== undefined) $('chkLike').checked = s.chkLike;
  if (s.chkStories !== undefined) $('chkStories').checked = s.chkStories;
  if (s.pauseMinutes1 !== undefined) $('pauseMinutes1').value = s.pauseMinutes1;
  if (s.pauseMinutes2 !== undefined) $('pauseMinutes2').value = s.pauseMinutes2;
  if (s.pauseEvery1 !== undefined) $('pauseEvery1').value = s.pauseEvery1;
  if (s.pauseEvery2 !== undefined) $('pauseEvery2').value = s.pauseEvery2;
  if (s.maxFollows !== undefined) $('maxFollows').value = s.maxFollows;
  if (s.maxStories !== undefined) $('maxStories').value = s.maxStories;
  if (s.serverErrorPause !== undefined) $('serverErrorPause').value = s.serverErrorPause;
  if (s.chkRecentOnly !== undefined) $('chkRecentOnly').checked = s.chkRecentOnly;
  if (s.scanMonths !== undefined) $('scanMonths').value = s.scanMonths;
  if (s.nextTagMinutes !== undefined) $('nextTagMinutes').value = s.nextTagMinutes;
  if (s.nextTagFollows !== undefined) $('nextTagFollows').value = s.nextTagFollows;
  if (s.unfollowOnPause !== undefined) $('unfollowOnPause').value = s.unfollowOnPause;
  if (s.unfollowAfterDays !== undefined) $('unfollowAfterDays').value = s.unfollowAfterDays;

  // Tab 1
  if (s.followList !== undefined) $('followList').value = s.followList;
  if (s.chkFollowListLike !== undefined) $('chkFollowListLike').checked = s.chkFollowListLike;
  if (s.chkFollowListStories !== undefined) $('chkFollowListStories').checked = s.chkFollowListStories;

  // Tab 2
  if (s.unfollowDays !== undefined) $('unfollowDays').value = s.unfollowDays;
  if (s.chkSkipFollowBack !== undefined) $('chkSkipFollowBack').checked = s.chkSkipFollowBack;
  if (s.maxUnfollowSession !== undefined) $('maxUnfollowSession').value = s.maxUnfollowSession;

  // Tab 3
  if (s.unfollowList !== undefined) $('unfollowList').value = s.unfollowList;

  updateListStats();

  // Restore running state
  if (s.automationState?.running) {
    setRunningUI(true, s.automationState.paused);
  }
}

async function saveSettings() {
  const existing = await chrome.storage.local.get(STORAGE_KEY);
  const current = existing[STORAGE_KEY] || {};

  const settings = {
    ...current,
    gsPauseMin: +$('gsPauseMin').value,
    gsPauseMax: +$('gsPauseMax').value,
    gsRetentionDays: +$('gsRetentionDays').value,
    tags,
    chkFollow: $('chkFollow').checked,
    chkLike: $('chkLike').checked,
    chkStories: $('chkStories').checked,
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
    followList: $('followList').value,
    chkFollowListLike: $('chkFollowListLike').checked,
    chkFollowListStories: $('chkFollowListStories').checked,
    unfollowDays: +$('unfollowDays').value,
    chkSkipFollowBack: $('chkSkipFollowBack').checked,
    maxUnfollowSession: +$('maxUnfollowSession').value,
    unfollowList: $('unfollowList').value,
  };

  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

// ======== Event Listeners ========

function setupEventListeners() {
  // Tabs
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

  // Add tag
  $('btnAddTag').addEventListener('click', addTag);
  $('tagInput').addEventListener('keydown', e => { if (e.key === 'Enter') addTag(); });

  // Settings toggle
  $('btnToggleSettings').addEventListener('click', () => {
    const panel = $('settingsPanel');
    const icon = $('settingsToggleIcon');
    panel.classList.toggle('collapsed');
    icon.textContent = panel.classList.contains('collapsed') ? '▶' : '▼';
  });

  // Blacklist modal
  $('btnBlacklist').addEventListener('click', openBlacklistModal);
  $('btnCloseModal').addEventListener('click', closeBlacklistModal);
  $('btnCancelBlacklist').addEventListener('click', closeBlacklistModal);
  $('btnSaveBlacklist').addEventListener('click', saveBlacklist);
  $('blacklistModal').addEventListener('click', e => {
    if (e.target === $('blacklistModal')) closeBlacklistModal();
  });

  // Run / Pause / Stop
  $('btnRun').addEventListener('click', handleRun);
  $('btnPause').addEventListener('click', handlePause);
  $('btnStop').addEventListener('click', handleStop);

  // Log clear
  $('btnClearLog').addEventListener('click', () => {
    $('logContent').innerHTML = '';
  });

  // Live list stats
  $('followList').addEventListener('input', updateListStats);
  $('unfollowList').addEventListener('input', updateListStats);

  // Auto-save settings on change
  document.querySelectorAll('input, textarea, select').forEach(el => {
    el.addEventListener('change', saveSettings);
  });
}

// ======== Tag management ========

function addTag() {
  const raw = $('tagInput').value.trim();
  if (!raw) return;
  // Normalize: remove leading # or spaces, support comma-separated
  const parts = raw.split(',').map(t => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean);
  parts.forEach(tag => {
    if (tag && !tags.includes(tag)) tags.push(tag);
  });
  $('tagInput').value = '';
  renderTags();
  saveSettings();
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
    chip.className = 'tag-chip' + (i === 0 ? ' active-tag' : '');
    chip.innerHTML = `<span>#${tag}</span>
      <button class="tag-chip-remove" title="Remove">×</button>`;
    chip.querySelector('.tag-chip-remove').addEventListener('click', () => removeTag(tag));
    list.appendChild(chip);
  });
}

// ======== Run / Pause / Stop ========

async function handleRun() {
  await saveSettings();

  if (activeTab === 0 && tags.length === 0) {
    addLog('Please add at least one tag before running.', 'error');
    return;
  }

  const igTab = await getInstagramTab();
  if (!igTab) {
    // Open Instagram
    const firstUrl = buildStartUrl();
    chrome.tabs.create({ url: firstUrl });
    addLog(`Opening Instagram…`, 'info');
    await sleep(2000);
  }

  const config = buildConfig();

  // Save automation state + command to storage
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const stored = data[STORAGE_KEY] || {};
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      ...stored,
      automationState: {
        running: true,
        paused: false,
        mode: getModeForTab(activeTab),
        config,
        tags: activeTab === 0 ? [...tags] : [],
        tagIndex: 0,
        listIndex: 0,
        stats: { follows: 0, unfollows: 0, likes: 0, storiesViewed: 0, errors: 0 },
        command: 'start',
        startedAt: Date.now(),
      }
    }
  });

  // Send message to content script
  try {
    const tab = await getInstagramTab();
    if (tab) {
      await chrome.tabs.sendMessage(tab.id, { action: 'START' });
    }
  } catch (_) { /* content script will pick it up via storage */ }

  setRunningUI(true, false);
  addLog(`Started: ${getModeLabel(activeTab)}`, 'info');
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

// ======== Status polling ========

function startStatusPolling() {
  statusPollInterval = setInterval(async () => {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const state = data[STORAGE_KEY]?.automationState;
    const statusMsg = data[STORAGE_KEY]?.lastStatus;

    if (!state) return;

    if (state.running !== isRunning || state.paused !== isPaused) {
      isRunning = state.running;
      isPaused = state.paused;
      setRunningUI(isRunning, isPaused);
    }

    if (statusMsg) {
      updateStatusBar(statusMsg.text, statusMsg.type, state.stats);
      // Show new log entries
      if (statusMsg.isNew) {
        addLog(statusMsg.text, statusMsg.type);
        // Clear the isNew flag
        data[STORAGE_KEY].lastStatus.isNew = false;
        await chrome.storage.local.set({ [STORAGE_KEY]: data[STORAGE_KEY] });
      }
    }

    // Update tag highlight
    if (state.tags && state.tagIndex !== undefined) {
      highlightActiveTag(state.tagIndex);
      const nextTag = state.tags[state.tagIndex];
      if (nextTag) {
        $('nextTagDisplay').textContent = `#${nextTag}`;
        $('nextTagRow').style.display = 'flex';
      }
    }
  }, 1000);
}

// ======== UI helpers ========

function setRunningUI(running, paused) {
  isRunning = running;
  isPaused = paused;

  $('btnRun').disabled = running;
  $('btnPause').disabled = !running;
  $('btnStop').disabled = !running;

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

function updateStatusBar(text, type, stats) {
  $('statusText').textContent = text || 'Running…';
  if (stats) {
    $('statusStats').innerHTML = `
      <span class="stat-item">👥 <span class="val">${stats.follows || 0}</span> follows</span>
      <span class="stat-item">❌ <span class="val">${stats.unfollows || 0}</span> unfollows</span>
      <span class="stat-item">❤️ <span class="val">${stats.likes || 0}</span> likes</span>
      <span class="stat-item">📖 <span class="val">${stats.storiesViewed || 0}</span> stories</span>
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
  const now = new Date();
  const time = now.toTimeString().slice(0, 8);
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-msg ${type}">${message}</span>`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
  // Keep max 200 entries
  while (log.children.length > 200) log.removeChild(log.firstChild);
}

function updateListStats() {
  const followLines = $('followList').value.split('\n').map(l => l.trim()).filter(Boolean);
  $('followListStats').textContent = `${followLines.length} username${followLines.length !== 1 ? 's' : ''} loaded`;

  const unfollowLines = $('unfollowList').value.split('\n').map(l => l.trim()).filter(Boolean);
  $('unfollowListStats').textContent = `${unfollowLines.length} username${unfollowLines.length !== 1 ? 's' : ''} loaded`;
}

async function refreshUnfollowOldStats() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const followedUsers = data[STORAGE_KEY]?.followedUsers || [];
  const days = +$('unfollowDays').value || 3;
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const eligible = followedUsers.filter(u => !u.unfollowedAt && u.followedAt < cutoff);
  $('unfollowOldStats').textContent =
    `${followedUsers.length} total followed · ${eligible.length} eligible to unfollow (>${days} days ago)`;
}

// ======== Blacklist modal ========

async function openBlacklistModal() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const blacklist = data[STORAGE_KEY]?.blacklist || [];
  $('blacklistText').value = blacklist.join('\n');
  $('blacklistModal').classList.add('open');
}

function closeBlacklistModal() {
  $('blacklistModal').classList.remove('open');
}

async function saveBlacklist() {
  const lines = $('blacklistText').value.split('\n').map(l => l.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const stored = data[STORAGE_KEY] || {};
  stored.blacklist = lines;
  await chrome.storage.local.set({ [STORAGE_KEY]: stored });
  addLog(`Blacklist saved: ${lines.length} entries`, 'info');
  closeBlacklistModal();
}

// ======== Helpers ========

function getModeForTab(tab) {
  return ['followByTag', 'followFromList', 'unfollowOld', 'unfollowFromList'][tab];
}

function getModeLabel(tab) {
  return [
    'Follow by tag/loc',
    'Follow from list',
    'Unfollow old',
    'Unfollow from list'
  ][tab];
}

function buildStartUrl() {
  if (activeTab === 0 && tags.length > 0) {
    return `https://www.instagram.com/explore/tags/${tags[0]}/`;
  }
  return 'https://www.instagram.com/';
}

function buildConfig() {
  return {
    // Global
    pauseMinSec: +$('gsPauseMin').value,
    pauseMaxSec: +$('gsPauseMax').value,
    retentionDays: +$('gsRetentionDays').value,

    // Tab 0
    followAccounts: $('chkFollow').checked,
    likePhoto: $('chkLike').checked,
    viewStories: $('chkStories').checked,
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

    // Tab 1
    followList: $('followList').value.split('\n').map(l => l.trim().replace(/^@/, '')).filter(Boolean),
    followListLike: $('chkFollowListLike').checked,
    followListStories: $('chkFollowListStories').checked,

    // Tab 2
    unfollowDays: +$('unfollowDays').value,
    skipFollowBack: $('chkSkipFollowBack').checked,
    maxUnfollowSession: +$('maxUnfollowSession').value,

    // Tab 3
    unfollowList: $('unfollowList').value.split('\n').map(l => l.trim().replace(/^@/, '')).filter(Boolean),
  };
}

async function getInstagramTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
  return tabs.length > 0 ? tabs[0] : null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
