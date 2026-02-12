// LinkedIn Business Page - Auto Invite Connections
//
// Instructions:
// 1. Go to your LinkedIn business page
// 2. Click "Invite to follow" to open the invite modal
// 3. Open browser DevTools (F12 or Ctrl+Shift+J / Cmd+Option+J)
// 4. Paste this entire script into the Console tab and press Enter
// 5. The script will select checkboxes and click Invite, up to 150 invites

(async function linkedInAutoInvite() {
  const MAX_INVITES = 150;
  const BATCH_DELAY_MS = 1500; // delay between checking each checkbox
  const SCROLL_DELAY_MS = 2000; // delay after scrolling to load more
  let inviteCount = 0;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Find all unchecked checkboxes in invite-eligible rows
  function getUncheckedBoxes() {
    // Target checkboxes inside rows that have the "can-invite" class
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

  // Find the main "Invite" / "Invite connections" submit button in the modal
  function getInviteSubmitButton() {
    // Look for the primary action button in the modal
    const candidates = document.querySelectorAll(
      'button.artdeco-button--primary, button[data-control-name="invite"], button.ml2'
    );
    for (const btn of candidates) {
      const text = btn.innerText.trim().toLowerCase();
      if (text.includes('invite') && !btn.disabled) {
        return btn;
      }
    }
    // Fallback: any button in the modal footer that says "invite"
    const allButtons = document.querySelectorAll('button');
    for (const btn of allButtons) {
      const text = btn.innerText.trim().toLowerCase();
      if (text.includes('invite') && !btn.disabled && !text.includes('cancel')) {
        // Avoid selecting tiny per-row buttons if any; prefer larger modal buttons
        const rect = btn.getBoundingClientRect();
        if (rect.width > 60) {
          return btn;
        }
      }
    }
    return null;
  }

  function scrollModalToBottom() {
    // Try multiple possible scroll containers
    const selectors = [
      '.artdeco-modal__content',
      '.os-viewport',
      '[role="dialog"] .overflow-y-auto',
      '.invitee-picker__connection-list',
      '.invitee-picker'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight > el.clientHeight) {
        el.scrollTop = el.scrollHeight;
        return true;
      }
    }
    return false;
  }

  console.log(`Starting LinkedIn Auto-Invite (max ${MAX_INVITES} invites)...`);
  console.log('Looking for unchecked checkboxes in invite modal...');

  let emptyScrollAttempts = 0;
  const MAX_EMPTY_SCROLLS = 5;

  while (inviteCount < MAX_INVITES) {
    let unchecked = getUncheckedBoxes();

    if (unchecked.length === 0) {
      // Try scrolling to load more connections
      scrollModalToBottom();
      await sleep(SCROLL_DELAY_MS);
      unchecked = getUncheckedBoxes();

      if (unchecked.length === 0) {
        emptyScrollAttempts++;
        console.log(`No unchecked boxes found after scroll (attempt ${emptyScrollAttempts}/${MAX_EMPTY_SCROLLS})`);
        if (emptyScrollAttempts >= MAX_EMPTY_SCROLLS) {
          console.log('No more connections to invite after multiple scroll attempts.');
          break;
        }
        await sleep(SCROLL_DELAY_MS);
        continue;
      }
    }

    emptyScrollAttempts = 0;

    // Select checkboxes in this batch (up to remaining quota)
    const batchSize = Math.min(unchecked.length, MAX_INVITES - inviteCount);
    console.log(`Found ${unchecked.length} unchecked boxes. Selecting ${batchSize}...`);

    for (let i = 0; i < batchSize; i++) {
      const checkbox = unchecked[i];
      // Click the label (more reliable) or the checkbox itself
      const row = checkbox.closest('.invitee-picker-connections-result-item--can-invite');
      const label = row ? row.querySelector(`label[for="${checkbox.id}"]`) : null;

      if (label) {
        label.click();
      } else {
        checkbox.click();
      }

      inviteCount++;
      console.log(`Selected ${inviteCount}/${MAX_INVITES}`);
      await sleep(200); // small delay between checkbox clicks
    }

    // After selecting a batch, click the Invite button
    await sleep(500);
    const inviteBtn = getInviteSubmitButton();
    if (inviteBtn) {
      console.log(`Clicking "${inviteBtn.innerText.trim()}" button to send ${batchSize} invites...`);
      inviteBtn.click();
      await sleep(BATCH_DELAY_MS);
    } else {
      console.log('Could not find the Invite submit button. Selected checkboxes but could not submit.');
      console.log('Please click the Invite button manually, then re-run the script to continue.');
      break;
    }

    // Wait for the modal to refresh / reload the list
    await sleep(SCROLL_DELAY_MS);
  }

  console.log(`Done! Total invitations sent: ${inviteCount}`);
})();
