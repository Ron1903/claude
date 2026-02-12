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

// Find the scrollable container inside the invite modal
function findScrollContainer() {
  const selectors = [
    '.artdeco-modal__content',
    '.os-viewport',
    '[role="dialog"] .overflow-y-auto',
    '.invitee-picker__connection-list',
    '.invitee-picker',
    '.artdeco-modal .artdeco-modal__content'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.scrollHeight > el.clientHeight) {
      return el;
    }
  }
  // Fallback: find any scrollable element inside the modal
  const modal = document.querySelector('.artdeco-modal, [role="dialog"]');
  if (modal) {
    const allDivs = modal.querySelectorAll('div');
    for (const div of allDivs) {
      if (div.scrollHeight > div.clientHeight + 50) {
        return div;
      }
    }
  }
  return null;
}

// Scroll the modal to load all connections
async function scrollToLoadAll(maxInvites) {
  const container = findScrollContainer();
  if (!container) {
    console.log('[LinkedIn Inviter] Could not find scroll container');
    return;
  }

  console.log('[LinkedIn Inviter] Auto-scrolling to load connections...');
  let previousHeight = 0;
  let sameHeightCount = 0;

  while (sameHeightCount < 5 && !stopRequested) {
    container.scrollTop = container.scrollHeight;
    await sleep(1500);

    if (container.scrollHeight === previousHeight) {
      sameHeightCount++;
    } else {
      sameHeightCount = 0;
      previousHeight = container.scrollHeight;
    }

    const loaded = document.querySelectorAll(
      '.invitee-picker-connections-result-item--can-invite'
    ).length;
    sendProgress(loaded, maxInvites, 'גלילה');
    console.log(`[LinkedIn Inviter] Scrolling... ${loaded} connections loaded`);

    // If we have enough, stop scrolling
    if (loaded >= maxInvites) {
      break;
    }
  }

  // Scroll back to top
  container.scrollTop = 0;
  await sleep(500);
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
