// popup.js - Handles the extension popup UI and communicates with the content script

let selectedCount = 150; // default

// Option buttons
document.querySelectorAll('.option-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedCount = parseInt(btn.dataset.count);
    document.getElementById('customCount').value = '';
  });
});

// Custom count input
document.getElementById('customCount').addEventListener('input', (e) => {
  const val = parseInt(e.target.value);
  if (val > 0) {
    selectedCount = val;
    document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
  }
});

// Show status banner
function showStatus(message, type) {
  const banner = document.getElementById('statusBanner');
  banner.textContent = message;
  banner.className = 'status-banner ' + type;
}

// Update progress bar
function updateProgress(current, total, phase) {
  const section = document.getElementById('progressSection');
  const fill = document.getElementById('progressFill');
  const text = document.getElementById('progressText');

  section.style.display = 'block';
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  fill.style.width = pct + '%';
  text.textContent = phase + ' - ' + current + '/' + total + ' (' + pct + '%)';
}

// Inject the content script and then send the start command
async function injectAndStart(tab) {
  try {
    // Always inject the content script fresh to make sure it's loaded
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  } catch (e) {
    console.log('Injection note:', e.message);
    // Script may already be injected, continue anyway
  }

  // Wait for script to initialize
  await new Promise(r => setTimeout(r, 1000));

  // Try sending the message up to 3 times
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'START_INVITE',
        count: selectedCount
      });
      if (response && response.ok) {
        console.log('Start command sent successfully');
        return true;
      }
    } catch (e) {
      console.log(`Attempt ${attempt} failed:`, e.message);
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  return false;
}

// Start button
document.getElementById('startBtn').addEventListener('click', async () => {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');

  startBtn.disabled = true;
  showStatus('מתחבר לעמוד...', 'info');

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url || !tab.url.includes('linkedin.com')) {
    showStatus('יש לפתוח עמוד עסקי בלינקדין קודם', 'error');
    startBtn.disabled = false;
    return;
  }

  // Show stop button
  startBtn.style.display = 'none';
  stopBtn.style.display = 'block';
  showStatus('מזריק סקריפט ומתחיל...', 'info');

  const success = await injectAndStart(tab);
  if (!success) {
    showStatus('לא הצלחתי להתחבר לעמוד. נסה לרענן את הדף ולנסות שוב', 'error');
    stopBtn.style.display = 'none';
    startBtn.style.display = 'block';
    startBtn.disabled = false;
  }
});

// Stop button
document.getElementById('stopBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'STOP_INVITE' });
    } catch (e) {
      console.log('Stop error:', e.message);
    }
  }

  document.getElementById('stopBtn').style.display = 'none';
  document.getElementById('startBtn').style.display = 'block';
  document.getElementById('startBtn').disabled = false;
  showStatus('נעצר על ידי המשתמש', 'error');
});

// Listen for progress updates from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'PROGRESS') {
    updateProgress(msg.current, msg.total, msg.phase);
    if (msg.phase === 'גלילה') {
      showStatus('גולל כדי לטעון אנשי קשר...', 'info');
    } else {
      showStatus('מסמן אנשי קשר...', 'info');
    }
  } else if (msg.action === 'DONE') {
    showStatus('סיום! הוזמנו ' + msg.count + ' אנשי קשר', 'success');
    document.getElementById('stopBtn').style.display = 'none';
    document.getElementById('startBtn').style.display = 'block';
    document.getElementById('startBtn').disabled = false;
    updateProgress(msg.count, msg.count, 'הושלם');
  } else if (msg.action === 'ERROR') {
    showStatus(msg.message, 'error');
    document.getElementById('stopBtn').style.display = 'none';
    document.getElementById('startBtn').style.display = 'block';
    document.getElementById('startBtn').disabled = false;
  }
});
