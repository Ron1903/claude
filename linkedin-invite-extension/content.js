// content.js - Runs on LinkedIn pages, handles the actual invite automation

let stopRequested = false;
let isRunning = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Send progress to popup
function sendProgress(current, total, phase) {
  chrome.runtime.sendMessage({ action: 'PROGRESS', current, total, phase });
}

function sendDone(count) {
  chrome.runtime.sendMessage({ action: 'DONE', count });
}

function sendError(message) {
  chrome.runtime.sendMessage({ action: 'ERROR', message });
}

// Check if we're on a LinkedIn company/business page
function isCompanyPage() {
  const url = window.location.href;
  return url.includes('/company/') || url.includes('/showcase/');
}

// Find and click the "Invite to follow" / "Invite connections" button on the page
async function openInviteModal() {
  // Look for the invite button on the company page admin tools
  const allButtons = document.querySelectorAll('button, a');
  for (const btn of allButtons) {
    const text = btn.innerText.trim().toLowerCase();
    if (
      text.includes('invite') &&
      (text.includes('follow') || text.includes('connections') || text.includes('to follow'))
    ) {
      btn.click();
      // Wait for modal to open
      await sleep(2000);
      // Verify modal opened
      const modal = document.querySelector('.artdeco-modal, [role="dialog"]');
      if (modal) {
        return true;
      }
      // Try waiting a bit more
      await sleep(2000);
      if (document.querySelector('.artdeco-modal, [role="dialog"]')) {
        return true;
      }
    }
  }
  return false;
}

// Check if invite modal is already open
function isModalOpen() {
  const modal = document.querySelector('.artdeco-modal, [role="dialog"]');
  if (!modal) return false;
  // Check if it contains invite-related content
  return !!modal.querySelector('.invitee-picker-connections-result-item--can-invite') ||
    modal.innerText.toLowerCase().includes('invite');
}

// Find ALL scrollable elements inside the invite modal
function findAllScrollContainers() {
  const modal = document.querySelector('.artdeco-modal, [role="dialog"]');
  if (!modal) return [];

  const scrollables = [];
  const allElements = modal.querySelectorAll('*');
  for (const el of allElements) {
    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    const isScrollable = (overflowY === 'auto' || overflowY === 'scroll') &&
      el.scrollHeight > el.clientHeight + 10;
    if (isScrollable) {
      scrollables.push(el);
    }
  }

  // Sort by scrollHeight descending - the biggest scrollable area is most likely the list
  scrollables.sort((a, b) => b.scrollHeight - a.scrollHeight);
  return scrollables;
}

// Count how many invite-eligible rows exist
function countInviteRows() {
  return document.querySelectorAll(
    '.invitee-picker-connections-result-item--can-invite'
  ).length;
}

// Scroll the modal to load all connections
async function scrollToLoadAll(maxInvites) {
  const containers = findAllScrollContainers();
  if (containers.length === 0) {
    console.log('[LinkedIn Inviter] Could not find any scroll container. Trying fallback...');
    // Fallback: try the modal content directly
    const fallback = document.querySelector('.artdeco-modal__content');
    if (fallback) containers.push(fallback);
  }

  console.log(`[LinkedIn Inviter] Found ${containers.length} scrollable container(s)`);

  // Try each scrollable container - the right one will cause item count to grow
  let workingContainer = null;
  const initialCount = countInviteRows();

  for (const container of containers) {
    container.scrollTop = container.scrollHeight;
    await sleep(2000);
    const newCount = countInviteRows();
    if (newCount > initialCount) {
      workingContainer = container;
      console.log(`[LinkedIn Inviter] Found the right scroll container (${newCount} items after scroll)`);
      break;
    }
    // Reset scroll
    container.scrollTop = 0;
  }

  // If no container caused new items to load, use the largest one
  if (!workingContainer && containers.length > 0) {
    workingContainer = containers[0];
    console.log('[LinkedIn Inviter] Using largest scrollable container as fallback');
  }

  if (!workingContainer) {
    console.log('[LinkedIn Inviter] No scroll container found at all');
    return;
  }

  // Now scroll repeatedly until all items are loaded
  console.log('[LinkedIn Inviter] Auto-scrolling to load all connections...');
  let previousCount = countInviteRows();
  let noChangeRounds = 0;
  const MAX_NO_CHANGE = 8; // be patient - wait up to 8 rounds with no new items

  while (noChangeRounds < MAX_NO_CHANGE && !stopRequested) {
    // Scroll to bottom
    workingContainer.scrollTop = workingContainer.scrollHeight;
    await sleep(2000);

    // Also try scrolling the last visible item into view for lazy-load triggers
    const allRows = document.querySelectorAll('.invitee-picker-connections-result-item--can-invite');
    if (allRows.length > 0) {
      allRows[allRows.length - 1].scrollIntoView({ behavior: 'smooth', block: 'end' });
      await sleep(1000);
    }

    const currentCount = countInviteRows();
    sendProgress(currentCount, maxInvites, 'גלילה');
    console.log(`[LinkedIn Inviter] Scrolling... ${currentCount} connections loaded`);

    if (currentCount === previousCount) {
      noChangeRounds++;
      // Try an extra nudge - scroll down a bit more
      workingContainer.scrollTop += 500;
      await sleep(1500);
    } else {
      noChangeRounds = 0;
      previousCount = currentCount;
    }

    // If we have enough, stop scrolling
    if (currentCount >= maxInvites) {
      console.log(`[LinkedIn Inviter] Loaded enough connections (${currentCount} >= ${maxInvites})`);
      break;
    }
  }

  const finalCount = countInviteRows();
  console.log(`[LinkedIn Inviter] Scrolling done. ${finalCount} total connections loaded.`);

  // Scroll back to top so selection starts from the beginning
  workingContainer.scrollTop = 0;
  await sleep(1000);
}

// Find all unchecked checkboxes in invite-eligible rows
function getUncheckedBoxes() {
  const rows = document.querySelectorAll(
    '.invitee-picker-connections-result-item--can-invite'
  );
  const unchecked = [];
  rows.forEach(row => {
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (checkbox && !checkbox.checked) {
      unchecked.push(checkbox);
    }
  });
  return unchecked;
}

// Find the main Invite submit button in the modal
function getInviteSubmitButton() {
  const candidates = document.querySelectorAll(
    'button.artdeco-button--primary, button[data-control-name="invite"], button.ml2'
  );
  for (const btn of candidates) {
    const text = btn.innerText.trim().toLowerCase();
    if (text.includes('invite') && !btn.disabled) {
      return btn;
    }
  }
  const allButtons = document.querySelectorAll('button');
  for (const btn of allButtons) {
    const text = btn.innerText.trim().toLowerCase();
    if (text.includes('invite') && !btn.disabled && !text.includes('cancel')) {
      const rect = btn.getBoundingClientRect();
      if (rect.width > 60) {
        return btn;
      }
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

  console.log(`[LinkedIn Inviter] Starting (max ${maxInvites} invites)...`);

  // Step 1: Make sure we're on a company page
  if (!isCompanyPage()) {
    sendError('יש להיות בעמוד עסקי בלינקדין');
    isRunning = false;
    return;
  }

  // Step 2: Open the invite modal if not already open
  if (!isModalOpen()) {
    console.log('[LinkedIn Inviter] Opening invite modal...');
    const opened = await openInviteModal();
    if (!opened && !isModalOpen()) {
      sendError('לא הצלחתי למצוא את כפתור ההזמנה. נסה לפתוח את חלון ההזמנות ידנית ולנסות שוב');
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

  if (unchecked.length === 0) {
    sendError('לא נמצאו אנשי קשר להזמנה. ודא שחלון ההזמנות פתוח');
    isRunning = false;
    return;
  }

  const toSelect = Math.min(unchecked.length, maxInvites);
  console.log(`[LinkedIn Inviter] Selecting ${toSelect} connections...`);

  for (let i = 0; i < toSelect; i++) {
    if (stopRequested) break;

    const checkbox = unchecked[i];
    const row = checkbox.closest('.invitee-picker-connections-result-item--can-invite');
    const label = row ? row.querySelector(`label[for="${checkbox.id}"]`) : null;

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
    console.log(`[LinkedIn Inviter] Clicking invite button...`);
    inviteBtn.click();
  } else {
    console.log('[LinkedIn Inviter] Could not find invite button - checkboxes are selected, click manually');
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
    console.log('[LinkedIn Inviter] Stop requested by user');
    sendResponse({ ok: true });
  }
  return true;
});
