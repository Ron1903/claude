// content.js - Runs on LinkedIn pages, handles the actual invite automation

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

// Check if we're on a LinkedIn company/business page
function isCompanyPage() {
  const url = window.location.href;
  return url.includes('linkedin.com/company') || url.includes('linkedin.com/showcase');
}

// Check if invite checkboxes are visible on the page (modal is open)
function hasInviteCheckboxes() {
  // Check for the specific invite picker rows
  const rows = document.querySelectorAll('.invitee-picker-connections-result-item--can-invite');
  if (rows.length > 0) return true;

  // Broader check: any checkbox inside an invitee-picker
  const pickers = document.querySelectorAll('[class*="invitee-picker"] input[type="checkbox"]');
  if (pickers.length > 0) return true;

  // Even broader: any ember checkbox in a modal/dialog
  const modalCheckboxes = document.querySelectorAll(
    '.artdeco-modal input[type="checkbox"], [role="dialog"] input[type="checkbox"]'
  );
  return modalCheckboxes.length > 0;
}

// Find and click the "Invite to follow" button on the page
async function openInviteModal() {
  const allClickables = document.querySelectorAll('button, a, [role="button"]');
  for (const el of allClickables) {
    const text = (el.innerText || el.textContent || '').trim().toLowerCase();
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    const combined = text + ' ' + ariaLabel;

    if (
      combined.includes('invite') ||
      combined.includes('הזמן') ||
      (combined.includes('follow') && combined.includes('invite'))
    ) {
      console.log(`[LinkedIn Inviter] Found button: "${text}" - clicking...`);
      el.click();
      // Wait for modal/checkboxes to appear
      for (let i = 0; i < 5; i++) {
        await sleep(1500);
        if (hasInviteCheckboxes()) return true;
      }
    }
  }
  return false;
}

// Count how many invite-eligible rows exist
function countInviteRows() {
  // Try the specific class first
  let count = document.querySelectorAll(
    '.invitee-picker-connections-result-item--can-invite'
  ).length;
  if (count > 0) return count;

  // Fallback: count any unchecked checkboxes in invite-related containers
  count = document.querySelectorAll(
    '[class*="invitee-picker"] input[type="checkbox"]'
  ).length;
  return count;
}

// Find ALL scrollable elements on the page that could contain the invite list
function findAllScrollContainers() {
  const scrollables = [];

  // Check inside modals/dialogs first
  const containers = document.querySelectorAll(
    '.artdeco-modal, [role="dialog"], [class*="invitee-picker"]'
  );

  for (const container of containers) {
    const allElements = container.querySelectorAll('*');
    for (const el of allElements) {
      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      const isScrollable = (overflowY === 'auto' || overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 10;
      if (isScrollable) {
        scrollables.push(el);
      }
    }
    // Also check the container itself
    const cStyle = window.getComputedStyle(container);
    if ((cStyle.overflowY === 'auto' || cStyle.overflowY === 'scroll') &&
      container.scrollHeight > container.clientHeight + 10) {
      scrollables.push(container);
    }
  }

  // Fallback: scan all divs on the page for scrollable ones near checkboxes
  if (scrollables.length === 0) {
    const allDivs = document.querySelectorAll('div');
    for (const div of allDivs) {
      if (div.scrollHeight > div.clientHeight + 100) {
        const hasCheckboxes = div.querySelector('input[type="checkbox"]');
        if (hasCheckboxes) {
          scrollables.push(div);
        }
      }
    }
  }

  // Deduplicate and sort by scrollHeight descending
  const unique = [...new Set(scrollables)];
  unique.sort((a, b) => b.scrollHeight - a.scrollHeight);
  return unique;
}

// Scroll to load all connections
async function scrollToLoadAll(maxInvites) {
  const containers = findAllScrollContainers();

  if (containers.length === 0) {
    console.log('[LinkedIn Inviter] No scroll containers found - will work with what is visible');
    return;
  }

  console.log(`[LinkedIn Inviter] Found ${containers.length} scrollable container(s). Testing...`);

  // Find which container actually loads more items when scrolled
  let workingContainer = null;
  const initialCount = countInviteRows();

  for (const container of containers) {
    container.scrollTop = container.scrollHeight;
    await sleep(2000);
    const newCount = countInviteRows();
    if (newCount > initialCount) {
      workingContainer = container;
      console.log(`[LinkedIn Inviter] Found correct scroll container (${newCount} items loaded)`);
      break;
    }
    container.scrollTop = 0;
  }

  if (!workingContainer) {
    workingContainer = containers[0];
    console.log('[LinkedIn Inviter] Using largest scrollable container');
  }

  // Scroll repeatedly until all items are loaded
  console.log('[LinkedIn Inviter] Scrolling to load all connections...');
  let previousCount = countInviteRows();
  let noChangeRounds = 0;
  const MAX_NO_CHANGE = 8;

  while (noChangeRounds < MAX_NO_CHANGE && !stopRequested) {
    workingContainer.scrollTop = workingContainer.scrollHeight;
    await sleep(2000);

    // Extra trigger: scroll last row into view
    const allRows = document.querySelectorAll(
      '.invitee-picker-connections-result-item--can-invite'
    );
    if (allRows.length > 0) {
      allRows[allRows.length - 1].scrollIntoView({ behavior: 'smooth', block: 'end' });
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

    if (currentCount >= maxInvites) {
      console.log(`[LinkedIn Inviter] Enough loaded (${currentCount} >= ${maxInvites})`);
      break;
    }
  }

  console.log(`[LinkedIn Inviter] Scroll done. ${countInviteRows()} total loaded.`);
  workingContainer.scrollTop = 0;
  await sleep(1000);
}

// Find all unchecked checkboxes
function getUncheckedBoxes() {
  // Method 1: specific invite picker rows
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
  if (unchecked.length > 0) return unchecked;

  // Method 2: any checkbox inside invitee-picker containers
  const checkboxes = document.querySelectorAll(
    '[class*="invitee-picker"] input[type="checkbox"]'
  );
  return Array.from(checkboxes).filter(cb => !cb.checked);
}

// Find the main Invite submit button
function getInviteSubmitButton() {
  const allButtons = document.querySelectorAll('button');
  // First pass: primary styled buttons with "invite" text
  for (const btn of allButtons) {
    const text = btn.innerText.trim().toLowerCase();
    const classes = btn.className.toLowerCase();
    if (text.includes('invite') && !btn.disabled && !text.includes('cancel')) {
      if (classes.includes('primary') || classes.includes('ml2')) {
        return btn;
      }
    }
  }
  // Second pass: any button with "invite" text that's wide enough (not a small per-row button)
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

  // Step 1: Verify we're on a company page
  if (!isCompanyPage()) {
    sendError('יש להיות בעמוד עסקי בלינקדין');
    isRunning = false;
    return;
  }

  // Step 2: Check if invite checkboxes are already visible (modal already open)
  if (hasInviteCheckboxes()) {
    console.log('[LinkedIn Inviter] Invite modal is already open, proceeding...');
  } else {
    // Try to open the invite modal
    console.log('[LinkedIn Inviter] Trying to open invite modal...');
    sendProgress(0, maxInvites, 'פותח חלון הזמנות...');
    const opened = await openInviteModal();

    if (!opened && !hasInviteCheckboxes()) {
      sendError('לא נמצאו צ\'קבוקסים להזמנה. פתח את חלון ההזמנות ידנית ולחץ שוב על התחל');
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
    sendError('לא נמצאו אנשי קשר להזמנה');
    isRunning = false;
    return;
  }

  const toSelect = Math.min(unchecked.length, maxInvites);
  console.log(`[LinkedIn Inviter] Selecting ${toSelect} connections...`);

  for (let i = 0; i < toSelect; i++) {
    if (stopRequested) break;

    const checkbox = unchecked[i];
    const row = checkbox.closest('[class*="invitee-picker"]') || checkbox.parentElement;
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
    console.log(`[LinkedIn Inviter] Clicking "${inviteBtn.innerText.trim()}" button...`);
    inviteBtn.click();
  } else {
    console.log('[LinkedIn Inviter] Could not find invite button - click it manually');
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
