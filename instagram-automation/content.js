'use strict';

/* =============================================
   content.js – Instagram Automation Engine
   Injected on: https://www.instagram.com/*
   ============================================= */

const STORAGE_KEY = 'igAutomation';

// ---- Selectors (multiple fallbacks for Instagram's changing DOM) ----
const SEL = {
  // Follow button in post dialog or profile page
  followBtn: [
    'button[type="button"]',
  ],
  // Like button
  likeBtn: [
    'svg[aria-label="Like"]',
    'svg[aria-label="לייק"]',
  ],
  // Close post dialog
  closeBtn: [
    'svg[aria-label="Close"]',
    'svg[aria-label="סגור"]',
    '[aria-label="Close"]',
  ],
  // Post links on tag/explore page
  postLinks: 'a[href*="/p/"]',
  // Username link in post header
  postUsername: 'header a[href^="/"]',
  // Dialog/modal container
  dialog: 'div[role="dialog"]',
  // Story ring (has stories to view)
  storyRing: 'canvas[aria-label], div[role="button"][tabindex]',
};

// ======== Main Automation Class ========

class InstagramBot {
  constructor() {
    this._running = false;
    this._paused = false;
    this._stopFlag = false;
    this._state = null;
  }

  async init() {
    // Check for active automation in storage
    const data = await this.getStorage();
    const state = data.automationState;

    if (state && state.running && state.command === 'start') {
      // Clear command so we don't re-trigger
      state.command = null;
      await this.setStorage({ automationState: state });
      this._state = state;
      await this.run();
    }

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.action === 'START') {
        this.handleStart();
      } else if (msg.action === 'PAUSE') {
        this.handlePause();
      } else if (msg.action === 'STOP') {
        this.handleStop();
      }
      sendResponse({ ok: true });
      return true;
    });

    // Also watch storage changes for commands
    chrome.storage.onChanged.addListener((changes) => {
      if (!changes[STORAGE_KEY]) return;
      const newVal = changes[STORAGE_KEY].newValue;
      const cmd = newVal?.automationState?.command;
      if (cmd === 'start' && !this._running) {
        this._state = newVal.automationState;
        this._state.command = null;
        this.run();
      } else if (cmd === 'pause') {
        this.handlePause();
      } else if (cmd === 'stop') {
        this.handleStop();
      }
    });
  }

  async handleStart() {
    const data = await this.getStorage();
    if (data.automationState?.running) return; // already running
    this._state = data.automationState;
    if (this._state) {
      this._state.command = null;
      await this.run();
    }
  }

  handlePause() {
    this._paused = !this._paused;
    this._state && (this._state.paused = this._paused);
    this.log(this._paused ? 'Paused' : 'Resumed', 'warn');
  }

  handleStop() {
    this._stopFlag = true;
    this._running = false;
    this._paused = false;
    this.log('Stopped by user', 'warn');
  }

  // ---- Main runner ----
  async run() {
    if (this._running) return;
    this._running = true;
    this._stopFlag = false;
    this._paused = false;

    const state = this._state;
    if (!state) return;

    state.running = true;
    state.paused = false;
    await this.saveState();

    try {
      switch (state.mode) {
        case 'followByTag':     await this.runFollowByTag();     break;
        case 'followFromList':  await this.runFollowFromList();  break;
        case 'unfollowOld':     await this.runUnfollowOld();     break;
        case 'unfollowFromList':await this.runUnfollowFromList();break;
        default:
          this.log(`Unknown mode: ${state.mode}`, 'error');
      }
    } catch (err) {
      this.log(`Error: ${err.message}`, 'error');
      console.error('[IG Bot]', err);
    } finally {
      this._running = false;
      state.running = false;
      state.command = null;
      await this.saveState();
      if (!this._stopFlag) this.log('Finished!', 'success');
    }
  }

  // ======== MODE: Follow by tag ========
  async runFollowByTag() {
    const state = this._state;
    const { config, tags } = state;
    if (!tags || tags.length === 0) {
      this.log('No tags configured', 'error');
      return;
    }

    for (let i = state.tagIndex || 0; i < tags.length; i++) {
      if (this._stopFlag) break;
      state.tagIndex = i;
      await this.saveState();

      const tag = tags[i];
      this.log(`Starting tag: #${tag}`, 'info');

      // Navigate to tag page
      const tagUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`;
      await this.navigateTo(tagUrl);
      await this.sleep(3000);
      await this.waitForElement(SEL.postLinks, 10000);

      await this.processTagPage(tag, config);

      if (this._stopFlag) break;

      // On tag change, maybe unfollow old
      if (config.unfollowOnPause > 0) {
        await this.unfollowOldBatch(config.unfollowAfterDays, config.unfollowOnPause);
      }
    }
  }

  async processTagPage(tag, config) {
    const state = this._state;
    const seen = new Set();
    const tagStartTime = Date.now();
    let tagFollows = 0;
    let scrollAttempts = 0;

    while (!this._stopFlag) {
      await this.waitWhilePaused();
      if (this._stopFlag) break;

      // Check tag-level limits
      const elapsedMin = (Date.now() - tagStartTime) / 60000;
      if (config.nextTagMinutes && elapsedMin >= config.nextTagMinutes) {
        this.log(`Time limit reached for #${tag}, moving to next tag`, 'info');
        break;
      }
      if (config.nextTagFollows && tagFollows >= config.nextTagFollows) {
        this.log(`Follow limit reached for #${tag}, moving to next tag`, 'info');
        break;
      }

      // Check global limits
      if (config.maxFollows && state.stats.follows >= config.maxFollows) {
        this.log(`Global follow limit (${config.maxFollows}) reached`, 'warn');
        this._stopFlag = true;
        break;
      }
      if (config.maxStoriesViews && state.stats.storiesViewed >= config.maxStoriesViews) {
        this.log(`Global story view limit (${config.maxStoriesViews}) reached`, 'warn');
        this._stopFlag = true;
        break;
      }

      // Collect post links visible on page
      const links = Array.from(document.querySelectorAll(SEL.postLinks))
        .filter(a => !seen.has(a.href) && a.href.includes('/p/'));

      if (links.length === 0) {
        // Scroll down to load more
        window.scrollBy(0, 800);
        await this.sleep(2500);
        scrollAttempts++;
        if (scrollAttempts > 10) {
          this.log(`No more posts found for #${tag}`, 'info');
          break;
        }
        continue;
      }

      scrollAttempts = 0;

      for (const link of links) {
        if (this._stopFlag) return;
        await this.waitWhilePaused();

        seen.add(link.href);

        // Open post
        link.click();
        const dialog = await this.waitForElement(SEL.dialog, 6000);
        if (!dialog) {
          await this.sleep(1000);
          continue;
        }

        await this.sleep(1000);

        // Get username
        const username = this.extractUsernameFromDialog(dialog);
        if (!username) {
          await this.closePostDialog();
          await this.randomSleep(config.pauseMinSec, config.pauseMaxSec);
          continue;
        }

        // Check blacklist
        if (await this.isBlacklisted(username)) {
          this.log(`Skipping blacklisted: @${username}`, 'info');
          await this.closePostDialog();
          await this.randomSleep(config.pauseMinSec, config.pauseMaxSec);
          continue;
        }

        // Check if already followed by us
        if (await this.isAlreadyFollowedByUs(username)) {
          await this.closePostDialog();
          await this.randomSleep(config.pauseMinSec, config.pauseMaxSec);
          continue;
        }

        // Follow
        if (config.followAccounts) {
          const followed = await this.clickFollowInDialog(dialog);
          if (followed) {
            state.stats.follows++;
            tagFollows++;
            await this.recordFollow(username);
            this.log(`Followed @${username}`, 'success');
            await this.saveState();
          } else {
            state.stats.errors++;
            // Pause if server rejected
            const pauseMs = this.withVariance(config.serverErrorPauseMin * 60000, 0.2);
            this.log(`Follow rejected, pausing ${Math.round(pauseMs/60000)} min`, 'warn');
            await this.closePostDialog();
            await this.sleep(pauseMs);
            continue;
          }
        }

        // Like
        if (config.likePhoto) {
          const liked = await this.clickLikeInDialog(dialog);
          if (liked) {
            state.stats.likes++;
            this.log(`Liked @${username}'s photo`, 'success');
            await this.saveState();
          }
        }

        await this.closePostDialog();
        await this.randomSleep(config.pauseMinSec, config.pauseMaxSec);

        // View stories (navigate to stories page)
        if (config.viewStories) {
          await this.viewUserStories(username, config);
        }

        // Pause every N follows
        await this.checkPauseConditions(config);
      }

      // Scroll for more
      window.scrollBy(0, 600);
      await this.sleep(2000);
    }
  }

  // ======== MODE: Follow from list ========
  // Finds all "Follow" buttons currently visible on the page (e.g. a followers/following list)
  // and clicks them one by one with delays. Scrolls to load more.
  async runFollowFromList() {
    const state = this._state;
    const { config } = state;
    const maxFollows = config.followListMax || 500;
    const maxScrollAttempts = config.followListScrollAttempts || 5;

    this.log('Scanning for Follow buttons on this page…', 'info');

    let scrollFails = 0;
    let sessionFollows = 0;

    while (!this._stopFlag && sessionFollows < maxFollows) {
      await this.waitWhilePaused();

      // Find all "Follow" buttons that are NOT "Following" / "Requested"
      const allButtons = Array.from(document.querySelectorAll('button[type="button"]'));
      const followButtons = allButtons.filter(btn => {
        const text = btn.textContent.trim();
        return text === 'Follow' || text === 'עקוב';
      });

      if (followButtons.length === 0) {
        // Try scrolling the followers modal or page
        const modal = document.querySelector('div[role="dialog"]') ||
                       document.querySelector('[style*="overflow"]');
        if (modal) {
          modal.scrollBy(0, 400);
        } else {
          window.scrollBy(0, 400);
        }
        await this.sleep(1800);
        scrollFails++;

        if (scrollFails >= maxScrollAttempts) {
          this.log(`No more Follow buttons found after ${maxScrollAttempts} scroll attempts.`, 'warn');
          break;
        }
        continue;
      }

      scrollFails = 0;

      for (const btn of followButtons) {
        if (this._stopFlag || sessionFollows >= maxFollows) break;
        await this.waitWhilePaused();

        // Extract username if possible (parent element often has a link)
        const parentLink = btn.closest('li, div')?.querySelector('a[href^="/"]');
        const hrefMatch = parentLink?.getAttribute('href')?.match(/^\/([^/]+)\/?$/);
        const username = hrefMatch ? hrefMatch[1] : null;

        if (username) {
          if (await this.isBlacklisted(username)) {
            this.log(`Skipping blacklisted: @${username}`, 'info');
            continue;
          }
          if (await this.isAlreadyFollowedByUs(username)) {
            continue;
          }
        }

        // Click follow
        btn.click();
        await this.sleep(1200);

        // Verify it changed
        const newText = btn.textContent.trim();
        const succeeded = newText !== 'Follow' && newText !== 'עקוב';

        if (succeeded) {
          sessionFollows++;
          state.stats.follows++;
          if (username) await this.recordFollow(username);
          this.log(`Followed${username ? ' @' + username : ''} (${sessionFollows}/${maxFollows})`, 'success');
          await this.saveState();
        }

        await this.randomSleep(config.pauseMinSec, config.pauseMaxSec);

        // Pause every N follows
        await this.checkPauseConditions(config);
      }
    }

    this.log(`Follow from list complete. Followed: ${sessionFollows}`, 'success');
  }

  // ======== MODE: Unfollow old ========
  async runUnfollowOld() {
    const state = this._state;
    const { config } = state;
    const cutoffMs = (config.unfollowDays || 3) * 24 * 3600 * 1000;
    const maxCount = config.maxUnfollowSession || 200;

    const data = await this.getStorage();
    const followed = data.followedUsers || [];

    const candidates = followed
      .filter(u => !u.unfollowedAt && (Date.now() - u.followedAt) >= cutoffMs)
      .slice(0, maxCount);

    if (candidates.length === 0) {
      this.log('No users eligible to unfollow', 'info');
      return;
    }

    this.log(`Unfollowing ${candidates.length} users…`, 'info');

    for (const user of candidates) {
      if (this._stopFlag) break;
      await this.waitWhilePaused();

      await this.unfollowUser(user.username, config.skipFollowBack);
      state.stats.unfollows++;
      await this.saveState();
      await this.randomSleep(config.pauseMinSec, config.pauseMaxSec);
    }
  }

  // ======== MODE: Unfollow from list ========
  async runUnfollowFromList() {
    const state = this._state;
    const { config } = state;
    const maxSession = config.maxUnfollowListSession || 200;
    const skipFB = config.unfollowListSkipFB || false;

    // Build unfollow list from stored followed users
    const data = await this.getStorage();
    const storedUsers = (data.followedUsers || [])
      .filter(u => !u.unfollowedAt)
      .slice(0, maxSession);

    if (storedUsers.length === 0) {
      this.log('No users in saved list to unfollow.', 'warn');
      return;
    }

    this.log(`Unfollowing ${storedUsers.length} users from list…`, 'info');

    for (let i = state.listIndex || 0; i < storedUsers.length; i++) {
      if (this._stopFlag) break;
      await this.waitWhilePaused();

      state.listIndex = i;
      const user = storedUsers[i];

      await this.unfollowUser(user.username, skipFB);
      state.stats.unfollows++;
      await this.saveState();
      await this.randomSleep(config.pauseMinSec, config.pauseMaxSec);
    }
  }

  // ======== Pause Conditions Helper ========
  async checkPauseConditions(config) {
    const follows = this._state?.stats?.follows || 0;
    const p1 = config.pauseEvery1 && follows > 0 && follows % config.pauseEvery1 === 0;
    const p2 = config.pauseEvery2 && follows > 0 && follows % config.pauseEvery2 === 0;
    if (p1 || p2) {
      const minutes = p2 ? config.pauseMinutes2 : config.pauseMinutes1;
      const pauseMs = this.withVariance(minutes * 60000, 0.2);
      this.log(`Scheduled pause: ${Math.round(pauseMs / 60000)} min after ${follows} follows`, 'warn');
      await this.sleep(pauseMs);
    }
  }

  // ======== Core Actions ========

  async clickFollowInDialog(dialog) {
    // Find Follow button that is NOT "Following" or "Requested"
    const buttons = Array.from(dialog.querySelectorAll('button[type="button"]'));
    const followBtn = buttons.find(btn => {
      const text = btn.textContent.trim();
      return text === 'Follow' || text === 'עקוב';
    });

    if (!followBtn) return false;

    try {
      followBtn.click();
      await this.sleep(1500);
      // Verify: button text should now be "Following" or "Requested"
      const newText = followBtn.textContent.trim();
      return newText !== 'Follow' && newText !== 'עקוב';
    } catch (e) {
      return false;
    }
  }

  async clickFollowOnProfile() {
    // Follow button on profile page
    const buttons = Array.from(document.querySelectorAll('button[type="button"]'));
    const followBtn = buttons.find(btn => {
      const text = btn.textContent.trim();
      return text === 'Follow' || text === 'עקוב';
    });

    if (!followBtn) {
      this.log('Follow button not found on profile', 'warn');
      return false;
    }

    try {
      followBtn.click();
      await this.sleep(1500);
      const newText = followBtn.textContent.trim();
      return newText !== 'Follow' && newText !== 'עקוב';
    } catch (e) {
      return false;
    }
  }

  async clickLikeInDialog(dialog) {
    // Like button: svg with aria-label="Like"
    for (const sel of SEL.likeBtn) {
      const svg = dialog.querySelector(sel);
      if (svg) {
        const btn = svg.closest('button');
        if (btn) {
          btn.click();
          await this.sleep(800);
          return true;
        }
      }
    }
    return false;
  }

  async likeLatestPost() {
    // On profile page, click the first post
    const firstPost = document.querySelector('a[href*="/p/"]');
    if (!firstPost) return false;
    firstPost.click();
    const dialog = await this.waitForElement(SEL.dialog, 5000);
    if (!dialog) return false;
    await this.sleep(800);
    const liked = await this.clickLikeInDialog(dialog);
    await this.sleep(500);
    await this.closePostDialog();
    return liked;
  }

  async closePostDialog() {
    // Try Escape key first (most reliable)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    await this.sleep(500);

    // Fallback: click close button
    for (const sel of SEL.closeBtn) {
      const el = document.querySelector(sel);
      if (el) {
        const btn = el.closest('button') || el;
        btn.click();
        await this.sleep(500);
        break;
      }
    }
  }

  async unfollowUser(username, skipFollowBack = false) {
    await this.navigateTo(`https://www.instagram.com/${username}/`);
    await this.sleep(2500);

    if (skipFollowBack) {
      // Check if they follow us (look for "Follows you" badge)
      const followsYou = document.body.innerText.includes('Follows you') ||
                         document.body.innerText.includes('עוקב.ת אחריך');
      if (followsYou) {
        this.log(`Skipped @${username} (follows you back)`, 'info');
        return;
      }
    }

    const buttons = Array.from(document.querySelectorAll('button[type="button"]'));
    const followingBtn = buttons.find(btn => {
      const text = btn.textContent.trim();
      return text === 'Following' || text === 'עוקב.ת' || text === 'Requested';
    });

    if (!followingBtn) {
      this.log(`@${username} not found or already unfollowed`, 'warn');
      return;
    }

    followingBtn.click();
    await this.sleep(1000);

    // Confirm unfollow in dialog
    const confirmBtn = await this.waitForElement('button[type="button"]', 3000);
    if (confirmBtn) {
      const allBtns = Array.from(document.querySelectorAll('button[type="button"]'));
      const unfollowConfirm = allBtns.find(b =>
        b.textContent.trim() === 'Unfollow' || b.textContent.trim() === 'הפסק לעקוב'
      );
      if (unfollowConfirm) {
        unfollowConfirm.click();
        await this.sleep(1000);
      }
    }

    await this.markUnfollowed(username);
    this.log(`Unfollowed @${username}`, 'success');
  }

  async viewUserStories(username, config) {
    const storiesUrl = `https://www.instagram.com/stories/${username}/`;
    await this.navigateTo(storiesUrl);
    await this.sleep(3000);

    // Wait for stories to load
    const storyEl = await this.waitForElement('[role="presentation"]', 5000);
    if (!storyEl) {
      this.log(`No stories for @${username}`, 'info');
      return;
    }

    // Watch a few story frames
    let frames = 0;
    while (frames < 5 && !this._stopFlag) {
      await this.sleep(5000); // Watch for 5 seconds

      // Try clicking forward arrow to go to next story frame
      const nextBtn = document.querySelector('[aria-label="Next"]') ||
                      document.querySelector('button[tabindex="0"][aria-label]');
      if (nextBtn) {
        nextBtn.click();
      } else {
        break;
      }
      frames++;
      this._state.stats.storiesViewed++;
      await this.saveState();
    }

    this.log(`Viewed stories of @${username}`, 'success');
    // Navigate back
    history.back();
    await this.sleep(2000);
  }

  async unfollowOldBatch(days, count) {
    const data = await this.getStorage();
    const cutoff = Date.now() - days * 24 * 3600 * 1000;
    const candidates = (data.followedUsers || [])
      .filter(u => !u.unfollowedAt && u.followedAt < cutoff)
      .slice(0, count);

    if (candidates.length === 0) return;
    this.log(`Unfollowing ${candidates.length} old users on break…`, 'info');

    for (const user of candidates) {
      if (this._stopFlag) break;
      await this.unfollowUser(user.username, false);
      this._state.stats.unfollows++;
      await this.randomSleep(
        this._state.config.pauseMinSec,
        this._state.config.pauseMaxSec
      );
    }
  }

  // ======== DOM helpers ========

  extractUsernameFromDialog(dialog) {
    const links = dialog.querySelectorAll('a[href^="/"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      // Username: single path segment, not /p/ or /explore/
      const match = href.match(/^\/([^/]+)\/?$/);
      if (match && !['p', 'explore', 'reels', 'stories'].includes(match[1])) {
        return match[1];
      }
    }
    return null;
  }

  async waitForElement(selector, timeoutMs = 8000) {
    const start = Date.now();
    // Handle array of selectors
    const selectors = Array.isArray(selector) ? selector : [selector];
    while (Date.now() - start < timeoutMs) {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      await this.sleep(300);
    }
    return null;
  }

  async navigateTo(url) {
    if (window.location.href === url) return;
    window.location.href = url;
    // Page will reload; automation will resume from storage
    await this.sleep(30000); // Wait for navigation (content script re-injects)
  }

  // ======== Storage helpers ========

  async getStorage() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return data[STORAGE_KEY] || {};
  }

  async setStorage(partial) {
    const data = await this.getStorage();
    await chrome.storage.local.set({ [STORAGE_KEY]: { ...data, ...partial } });
  }

  async saveState() {
    if (!this._state) return;
    await this.setStorage({ automationState: this._state });
  }

  async recordFollow(username) {
    const data = await this.getStorage();
    const followed = data.followedUsers || [];
    // Avoid duplicates
    if (!followed.find(u => u.username === username)) {
      followed.push({ username, followedAt: Date.now(), unfollowedAt: null });
    }
    await this.setStorage({ followedUsers: followed });
  }

  async markUnfollowed(username) {
    const data = await this.getStorage();
    const followed = (data.followedUsers || []).map(u =>
      u.username === username ? { ...u, unfollowedAt: Date.now() } : u
    );
    await this.setStorage({ followedUsers: followed });
  }

  async isBlacklisted(username) {
    const data = await this.getStorage();
    const bl = data.blacklist || [];
    return bl.includes(username.toLowerCase());
  }

  async isAlreadyFollowedByUs(username) {
    const data = await this.getStorage();
    const followed = data.followedUsers || [];
    const user = followed.find(u => u.username === username);
    return user && !user.unfollowedAt;
  }

  // ======== Utilities ========

  async waitWhilePaused() {
    while (this._paused && !this._stopFlag) {
      await this.sleep(500);
      // Re-read paused state from storage
      const data = await this.getStorage();
      if (data.automationState?.paused === false) {
        this._paused = false;
      }
    }
  }

  withVariance(value, variance) {
    const factor = 1 - variance + Math.random() * variance * 2;
    return Math.round(value * factor);
  }

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async randomSleep(minSec, maxSec) {
    const ms = (minSec + Math.random() * (maxSec - minSec)) * 1000;
    await this.sleep(Math.round(ms));
  }

  log(text, type = 'info') {
    console.log(`[IG Bot][${type}] ${text}`);
    // Write to storage for popup to read
    const status = { text, type, isNew: true, timestamp: Date.now() };
    this.getStorage().then(data => {
      chrome.storage.local.set({
        [STORAGE_KEY]: { ...data, lastStatus: status }
      });
    });
  }
}

// ======== Bootstrap ========
// Prevent double-init on SPA navigation
if (!window.__igBotInit) {
  window.__igBotInit = true;
  const bot = new InstagramBot();
  bot.init().catch(err => console.error('[IG Bot] Init error:', err));
}
