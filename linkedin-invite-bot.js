// LinkedIn Business Page - Auto Invite Connections
//
// Instructions:
// 1. Go to your LinkedIn business page
// 2. Click "Invite to follow" to open the invite modal
// 3. Scroll down in the modal to load enough connections (or the script will invite what's visible)
// 4. Open browser DevTools (F12 or Ctrl+Shift+J / Cmd+Option+J)
// 5. Paste this entire script into the Console tab and press Enter
// 6. The script will click "Invite" buttons every 2 seconds, up to 150 invites

(async function linkedInAutoInvite() {
  const MAX_INVITES = 150;
  const DELAY_MS = 2000; // 2 seconds between clicks
  let inviteCount = 0;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getInviteButtons() {
    // LinkedIn uses different selectors depending on page version.
    // Target buttons within the invite modal that say "Invite"
    const allButtons = document.querySelectorAll(
      'button[aria-label*="Invite"], button[aria-label*="invite"]'
    );

    // Filter to only enabled, uninvited buttons (not "Pending" or disabled)
    return Array.from(allButtons).filter(btn => {
      const text = btn.innerText.trim().toLowerCase();
      return text === 'invite' && !btn.disabled;
    });
  }

  function scrollModalToBottom() {
    const modal = document.querySelector(
      '.artdeco-modal__content, .os-viewport, [role="dialog"] .overflow-y-auto'
    );
    if (modal) {
      modal.scrollTop = modal.scrollHeight;
    }
  }

  console.log(`🚀 Starting LinkedIn Auto-Invite (max ${MAX_INVITES} invites)...`);

  while (inviteCount < MAX_INVITES) {
    const buttons = getInviteButtons();

    if (buttons.length === 0) {
      // Try scrolling to load more connections
      scrollModalToBottom();
      await sleep(1500);

      const retryButtons = getInviteButtons();
      if (retryButtons.length === 0) {
        console.log(`No more invite buttons found. Total invites sent: ${inviteCount}`);
        break;
      }
    }

    const btn = getInviteButtons()[0];
    if (!btn) break;

    btn.click();
    inviteCount++;
    console.log(`Invited ${inviteCount}/${MAX_INVITES}`);

    if (inviteCount >= MAX_INVITES) {
      console.log(`✅ Reached ${MAX_INVITES} invites. Stopping.`);
      break;
    }

    await sleep(DELAY_MS);
  }

  console.log(`Done! Total invitations sent: ${inviteCount}`);
})();
