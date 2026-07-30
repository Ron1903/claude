// content.js - Runs on LinkedIn pages, handles the actual invite automation

// Guard against double injection
if (window.__linkedInInviterLoaded) {
  console.log('[LinkedIn Inviter] Already loaded, skipping re-injection');
} else {
  window.__linkedInInviterLoaded = true;

  let stopRequested = false;
  let isRunning = false;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function sendProgress(current, total, phase) {
    chrome.runtime.sendMessage({ action: 'PROGRESS', current, total, phase }).catch(() => {});
  }

  function sendDone(count) {
    chrome.runtime.sendMessage({ action: 'DONE', count }).catch(() => {});
  }

  function sendError(message) {
    chrome.runtime.sendMessage({ action: 'ERROR', message }).catch(() => {});
  }

  // Debug: log what we can find on the page
  function debugPageState() {
    console.log('[LinkedIn Inviter] === DEBUG PAGE STATE ===');
    console.log('[LinkedIn Inviter] URL:', window.location.href);
    console.log('[LinkedIn Inviter] Company page:', window.location.href.includes('/company'));

    // Check for modals
    const artdecoModals = document.querySelectorAll('.artdeco-modal');
    console.log('[LinkedIn Inviter] .artdeco-modal elements:', artdecoModals.length);

    const dialogs = document.querySelectorAll('[role="dialog"]');
    console.log('[LinkedIn Inviter] [role="dialog"] elements:', dialogs.length);

    // Check for invite-related elements
    const inviteRows = document.querySelectorAll('.invitee-picker-connections-result-item--can-invite');
    console.log('[LinkedIn Inviter] invite rows (.invitee-picker-connections-result-item--can-invite):', inviteRows.length);

    const inviteePickers = document.querySelectorAll('[class*="invitee"]');
    console.log('[LinkedIn Inviter] Elements with "invitee" in class:', inviteePickers.length);
    inviteePickers.forEach((el, i) => {
      console.log(`[LinkedIn Inviter]   [${i}] tag=${el.tagName} class="${el.className.substring(0, 100)}"`);
    });

    // Check for checkboxes
    const allCheckboxes = document.querySelectorAll('input[type="checkbox"]');
    console.log('[LinkedIn Inviter] Total checkboxes on page:', allCheckboxes.length);

    // Check for ember checkboxes
    const emberCheckboxes = document.querySelectorAll('.ember-checkbox');
    console.log('[LinkedIn Inviter] Ember checkboxes:', emberCheckboxes.length);

    // Check for any element with "invite" in its text (buttons)
    const buttons = document.querySelectorAll('button');
    const inviteButtons = [];
    buttons.forEach(btn => {
      const text = (btn.innerText || '').trim().toLowerCase();
      if (text.includes('invite') || text.includes('הזמ')) {
        inviteButtons.push({ text: text.substring(0, 50), classes: btn.className.substring(0, 80) });
      }
    });
    console.log('[LinkedIn Inviter] Buttons with "invite" text:', JSON.stringify(inviteButtons));
    console.log('[LinkedIn Inviter] === END DEBUG ===');
  }

  // Check if we're on a LinkedIn company/business page
  function isCompanyPage() {
    const url = window.location.href;
    return url.includes('linkedin.com/company') || url.includes('linkedin.com/showcase');
  }

  // Check if invite checkboxes are visible on the page
  function hasInviteCheckboxes() {
    // Method 1: specific invite picker rows
    if (document.querySelectorAll('.invitee-picker-connections-result-item--can-invite').length > 0) return true;
    // Method 2: any element with "invitee" class containing checkboxes
    if (document.querySelectorAll('[class*="invitee"] input[type="checkbox"]').length > 0) return true;
    // Method 3: ember checkboxes inside a modal
    if (document.querySelectorAll('.artdeco-modal .ember-checkbox').length > 0) return true;
    if (document.querySelectorAll('[role="dialog"] .ember-checkbox').length > 0) return true;
    // Method 4: any modal/dialog with checkboxes
    if (document.querySelectorAll('.artdeco-modal input[type="checkbox"]').length > 0) return true;
    if (document.querySelectorAll('[role="dialog"] input[type="checkbox"]').length > 0) return true;
    return false;
  }

  // Find and click the "Invite to follow" button
  async function openInviteModal() {
    const allClickables = document.querySelectorAll('button, a, [role="button"], span[class*="button"]');
    for (const el of allClickables) {
      const text = (el.innerText || el.textContent || '').trim().toLowerCase();
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const combined = text + ' ' + ariaLabel;

      if (
        combined.includes('invite') ||
        combined.includes('הזמן')
      ) {
        console.log(`[LinkedIn Inviter] Clicking element: "${text.substring(0, 40)}"`);
        el.click();
        for (let i = 0; i < 6; i++) {
          await sleep(1500);
          if (hasInviteCheckboxes()) return true;
        }
      }
    }
    return false;
  }

  // Count invite-eligible rows
  function countInviteRows() {
    let count = document.querySelectorAll('.invitee-picker-connections-result-item--can-invite').length;
    if (count > 0) return count;
    // Fallback: count checkboxes in invitee containers
    count = document.querySelectorAll('[class*="invitee"] input[type="checkbox"]').length;
    if (count > 0) return count;
    // Broader fallback: checkboxes in modal
    count = document.querySelectorAll('.artdeco-modal input[type="checkbox"], [role="dialog"] input[type="checkbox"]').length;
    return count;
  }

  // Find all scrollable elements that could contain the invite list
  function findAllScrollContainers() {
    const scrollables = [];

    // Look inside modals/dialogs and invitee-picker containers
    const wrappers = document.querySelectorAll(
      '.artdeco-modal, [role="dialog"], [class*="invitee-picker"], [class*="invitee"]'
    );

    for (const wrapper of wrappers) {
      // Check the wrapper itself
      if (wrapper.scrollHeight > wrapper.clientHeight + 10) {
        scrollables.push(wrapper);
      }
      // Check all children
      const children = wrapper.querySelectorAll('*');
      for (const el of children) {
        if (el.scrollHeight > el.clientHeight + 10) {
          const style = window.getComputedStyle(el);
          const ov = style.overflowY;
          if (ov === 'auto' || ov === 'scroll' || ov === 'hidden') {
            scrollables.push(el);
          }
        }
      }
    }

    // Fallback: any div with checkboxes that is scrollable
    if (scrollables.length === 0) {
      document.querySelectorAll('div').forEach(div => {
        if (div.scrollHeight > div.clientHeight + 50 && div.querySelector('input[type="checkbox"]')) {
          scrollables.push(div);
        }
      });
    }

    // Deduplicate and sort biggest first
    const unique = [...new Set(scrollables)];
    unique.sort((a, b) => b.scrollHeight - a.scrollHeight);
    return unique;
  }

  // Scroll to load all connections
  async function scrollToLoadAll(maxInvites) {
    const containers = findAllScrollContainers();

    if (containers.length === 0) {
      console.log('[LinkedIn Inviter] No scroll containers found');
      return;
    }

    console.log(`[LinkedIn Inviter] Found ${containers.length} scrollable container(s)`);

    // Find which container loads more items when scrolled
    let workingContainer = null;
    const initialCount = countInviteRows();

    for (const container of containers) {
      const prevScroll = container.scrollTop;
      container.scrollTop = container.scrollHeight;
      await sleep(2500);
      const newCount = countInviteRows();
      if (newCount > initialCount) {
        workingContainer = container;
        console.log(`[LinkedIn Inviter] Correct scroll container found (${newCount} items)`);
        break;
      }
      container.scrollTop = prevScroll;
    }

    if (!workingContainer) {
      workingContainer = containers[0];
      console.log('[LinkedIn Inviter] Using largest container as fallback');
    }

    // Scroll until all items loaded
    let previousCount = countInviteRows();
    let noChangeRounds = 0;
    const MAX_NO_CHANGE = 8;

    while (noChangeRounds < MAX_NO_CHANGE && !stopRequested) {
      workingContainer.scrollTop = workingContainer.scrollHeight;
      await sleep(2000);

      // Trigger lazy loading by scrolling last item into view
      const rows = document.querySelectorAll(
        '.invitee-picker-connections-result-item--can-invite, [class*="invitee"] input[type="checkbox"]'
      );
      if (rows.length > 0) {
        rows[rows.length - 1].scrollIntoView({ behavior: 'smooth', block: 'end' });
        await sleep(1000);
      }

      const currentCount = countInviteRows();
      sendProgress(currentCount, maxInvites, 'גלילה');
      console.log(`[LinkedIn Inviter] ${currentCount} connections loaded`);

      if (currentCount === previousCount) {
        noChangeRounds++;
        workingContainer.scrollTop += 500;
        await sleep(1500);
      } else {
        noChangeRounds = 0;
        previousCount = currentCount;
      }

      if (currentCount >= maxInvites) break;
    }

    console.log(`[LinkedIn Inviter] Scroll done. ${countInviteRows()} loaded.`);
    workingContainer.scrollTop = 0;
    await sleep(1000);
  }

  // Find all unchecked checkboxes
  function getUncheckedBoxes() {
    const unchecked = [];

    // Method 1: specific invite rows
    document.querySelectorAll('.invitee-picker-connections-result-item--can-invite').forEach(row => {
      const cb = row.querySelector('input[type="checkbox"]');
      if (cb && !cb.checked) unchecked.push(cb);
    });
    if (unchecked.length > 0) return unchecked;

    // Method 2: invitee-picker containers
    document.querySelectorAll('[class*="invitee"] input[type="checkbox"]').forEach(cb => {
      if (!cb.checked) unchecked.push(cb);
    });
    if (unchecked.length > 0) return unchecked;

    // Method 3: checkboxes in any modal/dialog
    document.querySelectorAll('.artdeco-modal input[type="checkbox"], [role="dialog"] input[type="checkbox"]').forEach(cb => {
      if (!cb.checked) unchecked.push(cb);
    });
    return unchecked;
  }

  // Find the Invite submit button
  function getInviteSubmitButton() {
    const allButtons = document.querySelectorAll('button');
    // Primary buttons with "invite" text
    for (const btn of allButtons) {
      const text = btn.innerText.trim().toLowerCase();
      const classes = btn.className.toLowerCase();
      if (text.includes('invite') && !btn.disabled && !text.includes('cancel')) {
        if (classes.includes('primary') || classes.includes('ml2')) return btn;
      }
    }
    // Any button with "invite" text
    for (const btn of allButtons) {
      const text = btn.innerText.trim().toLowerCase();
      if (text.includes('invite') && !btn.disabled && !text.includes('cancel')) {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 60) return btn;
      }
    }
    return null;
  }

  // Main invite flow
  async function startInviting(maxInvites) {
    if (isRunning) {
      sendError('כבר רץ תהליך הזמנות');
      return;
    }

    isRunning = true;
    stopRequested = false;
    let inviteCount = 0;

    console.log(`[LinkedIn Inviter] Starting (max ${maxInvites})...`);

    // Always debug first
    debugPageState();

    // Step 1: Verify company page
    if (!isCompanyPage()) {
      sendError('יש להיות בעמוד עסקי בלינקדין (URL צריך להכיל /company/)');
      isRunning = false;
      return;
    }

    // Step 2: Check if checkboxes already visible
    if (hasInviteCheckboxes()) {
      console.log('[LinkedIn Inviter] Invite checkboxes found, proceeding...');
    } else {
      console.log('[LinkedIn Inviter] No checkboxes found, trying to open invite modal...');
      sendProgress(0, maxInvites, 'פותח חלון הזמנות...');
      await openInviteModal();

      if (!hasInviteCheckboxes()) {
        debugPageState();
        sendError('לא נמצאו צ\'קבוקסים. פתח את חלון ההזמנות ידנית, ואז לחץ התחל שוב. (בדוק Console ב-F12 לפרטים)');
        isRunning = false;
        return;
      }
    }

    if (stopRequested) { finish(inviteCount); return; }

    // Step 3: Scroll to load connections
    await scrollToLoadAll(maxInvites);

    if (stopRequested) { finish(inviteCount); return; }

    // Step 4: Select checkboxes
    const unchecked = getUncheckedBoxes();
    console.log(`[LinkedIn Inviter] Found ${unchecked.length} unchecked checkboxes`);

    if (unchecked.length === 0) {
      sendError('לא נמצאו אנשי קשר להזמנה');
      isRunning = false;
      return;
    }

    const toSelect = Math.min(unchecked.length, maxInvites);
    console.log(`[LinkedIn Inviter] Selecting ${toSelect} connections...`);

    for (let i = 0; i < toSelect; i++) {
      if (stopRequested) break;

      const checkbox = unchecked[i];
      // Try clicking the label first, then the checkbox
      const parent = checkbox.closest('[class*="invitee"]') || checkbox.parentElement;
      const label = parent ? parent.querySelector(`label[for="${checkbox.id}"]`) : null;

      if (label) {
        label.click();
      } else {
        checkbox.click();
      }

      inviteCount++;
      sendProgress(inviteCount, toSelect, 'בחירה');

      if (inviteCount % 10 === 0) {
        console.log(`[LinkedIn Inviter] Selected ${inviteCount}/${toSelect}`);
      }
      await sleep(150);
    }

    if (stopRequested) { finish(inviteCount); return; }

    // Step 5: Click Invite button
    await sleep(500);
    const inviteBtn = getInviteSubmitButton();
    if (inviteBtn) {
      console.log(`[LinkedIn Inviter] Clicking "${inviteBtn.innerText.trim()}"...`);
      inviteBtn.click();
    } else {
      console.log('[LinkedIn Inviter] Invite button not found - click it manually');
    }

    finish(inviteCount);
  }

  function finish(count) {
    console.log(`[LinkedIn Inviter] Done! Invited: ${count}`);
    sendDone(count);
    isRunning = false;
    stopRequested = false;
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'START_INVITE') {
      startInviting(msg.count);
      sendResponse({ ok: true });
    } else if (msg.action === 'STOP_INVITE') {
      stopRequested = true;
      console.log('[LinkedIn Inviter] Stop requested');
      sendResponse({ ok: true });
    }
    return true;
  });

  console.log('[LinkedIn Inviter] Content script loaded successfully on:', window.location.href);
}
