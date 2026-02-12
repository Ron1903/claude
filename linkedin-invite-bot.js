// LinkedIn Business Page - Auto Invite Connections
//
// Instructions:
// 1. Go to your LinkedIn business page
// 2. Click "Invite to follow" to open the invite modal
// 3. Open browser DevTools (F12 or Ctrl+Shift+J / Cmd+Option+J)
// 4. Paste this entire script into the Console tab and press Enter
// 5. The script will auto-scroll to load all connections, then select and invite
//
// NOTE: "net::ERR_BLOCKED_BY_CLIENT" errors are from your ad blocker blocking
// LinkedIn tracking requests. They are harmless and do not affect the script.

(async function linkedInAutoInvite() {
  const MAX_INVITES = 150;
  const BATCH_DELAY_MS = 1500;
  const SCROLL_DELAY_MS = 1500;
  let inviteCount = 0;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Find the scrollable container inside the invite modal
  function findScrollContainer() {
    // Try known selectors first
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

  // Scroll the modal list to load all connections
  async function scrollToLoadAll() {
    const container = findScrollContainer();
    if (!container) {
      console.log('Could not find scroll container. Please scroll manually first.');
      return;
    }

    console.log('Auto-scrolling to load all connections...');
    let previousHeight = 0;
    let sameHeightCount = 0;

    while (sameHeightCount < 5) {
      container.scrollTop = container.scrollHeight;
      await sleep(SCROLL_DELAY_MS);

      if (container.scrollHeight === previousHeight) {
        sameHeightCount++;
      } else {
        sameHeightCount = 0;
        previousHeight = container.scrollHeight;
      }

      const loaded = document.querySelectorAll(
        '.invitee-picker-connections-result-item--can-invite'
      ).length;
      console.log(`Scrolling... ${loaded} invite-eligible connections loaded so far`);
    }

    // Scroll back to top so we start selecting from the beginning
    container.scrollTop = 0;
    await sleep(500);

    const totalLoaded = document.querySelectorAll(
      '.invitee-picker-connections-result-item--can-invite'
    ).length;
    console.log(`Finished scrolling. ${totalLoaded} total invite-eligible connections loaded.`);
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

  // Find the main "Invite" submit button in the modal
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

  // --- Start ---
  console.log(`Starting LinkedIn Auto-Invite (max ${MAX_INVITES} invites)...`);
  console.log('(Ignore any "ERR_BLOCKED_BY_CLIENT" errors - those are from your ad blocker and are harmless)\n');

  // Phase 1: Auto-scroll to load all connections
  await scrollToLoadAll();

  // Phase 2: Select checkboxes and submit
  let unchecked = getUncheckedBoxes();

  if (unchecked.length === 0) {
    console.log('No invite-eligible connections found. Make sure the invite modal is open.');
    return;
  }

  const toSelect = Math.min(unchecked.length, MAX_INVITES);
  console.log(`\nSelecting ${toSelect} connections...`);

  for (let i = 0; i < toSelect; i++) {
    const checkbox = unchecked[i];
    const row = checkbox.closest('.invitee-picker-connections-result-item--can-invite');
    const label = row ? row.querySelector(`label[for="${checkbox.id}"]`) : null;

    if (label) {
      label.click();
    } else {
      checkbox.click();
    }

    inviteCount++;
    if (inviteCount % 10 === 0 || inviteCount === toSelect) {
      console.log(`Selected ${inviteCount}/${toSelect}`);
    }
    await sleep(150);
  }

  // Phase 3: Click the Invite button
  await sleep(500);
  const inviteBtn = getInviteSubmitButton();
  if (inviteBtn) {
    console.log(`\nClicking "${inviteBtn.innerText.trim()}" button to send ${inviteCount} invites...`);
    inviteBtn.click();
  } else {
    console.log('\nCould not find the Invite submit button.');
    console.log('All checkboxes are selected - please click the Invite button manually.');
  }

  console.log(`\nDone! Total invitations sent: ${inviteCount}`);
})();
