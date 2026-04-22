/**
 * JobAutoFill — Popup Script
 * Handles tab switching, profile CRUD, autofill trigger, and stats display.
 */

// ── Tab Switching ──────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// ── Ollama Status Check ────────────────────────────────────────

async function checkOllamaStatus() {
  const dot = document.getElementById('ollamaStatus');
  const text = document.getElementById('ollamaStatusText');
  try {
    const { settings } = await chrome.storage.local.get(['settings']);
    const url = settings?.ollamaUrl || 'http://localhost:11434';
    const response = await fetch(`${url}/api/tags`, { method: 'GET', signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      dot.classList.add('online');
      dot.classList.remove('offline');
      text.textContent = 'Ollama Online';
    } else {
      throw new Error('Bad response');
    }
  } catch {
    dot.classList.add('offline');
    dot.classList.remove('online');
    text.textContent = 'Ollama Offline';
  }
}

// ── Profile Management ─────────────────────────────────────────

const profileFields = ['profileName', 'profileEmail', 'profilePhone', 'profileLinkedin', 'profilePortfolio', 'profileSkills', 'profileResume'];

async function loadProfile() {
  const { profile } = await chrome.storage.local.get(['profile']);
  if (!profile) return;
  document.getElementById('profileName').value = profile.name || '';
  document.getElementById('profileEmail').value = profile.email || '';
  document.getElementById('profilePhone').value = profile.phone || '';
  document.getElementById('profileLinkedin').value = profile.linkedin || '';
  document.getElementById('profilePortfolio').value = profile.portfolio || '';
  document.getElementById('profileSkills').value = (profile.skills || []).join(', ');
  document.getElementById('profileResume').value = profile.resumeText || '';
}

async function saveProfile() {
  const profile = {
    name: document.getElementById('profileName').value.trim(),
    email: document.getElementById('profileEmail').value.trim(),
    phone: document.getElementById('profilePhone').value.trim(),
    linkedin: document.getElementById('profileLinkedin').value.trim(),
    portfolio: document.getElementById('profilePortfolio').value.trim(),
    skills: document.getElementById('profileSkills').value.split(',').map(s => s.trim()).filter(Boolean),
    resumeText: document.getElementById('profileResume').value.trim(),
    encrypted: false
  };

  if (!profile.name || !profile.email) {
    showMessage('profileMessage', 'Name and email are required.', 'error');
    return;
  }

  await chrome.storage.local.set({ profile });
  showMessage('profileMessage', 'Profile saved.', 'success');
}

document.getElementById('saveProfile').addEventListener('click', saveProfile);

// ── Encryption ─────────────────────────────────────────────────

document.getElementById('encryptProfile').addEventListener('click', async () => {
  const { profile } = await chrome.storage.local.get(['profile']);
  if (!profile) {
    showMessage('profileMessage', 'Save a profile first.', 'error');
    return;
  }

  if (profile.encrypted) {
    // Decrypt
    const passphrase = prompt('Enter passphrase to decrypt:');
    if (!passphrase) return;
    try {
      const { profileEncrypted, encryptionMeta } = await chrome.storage.local.get(['profileEncrypted', 'encryptionMeta']);
      const decrypted = await decryptData(profileEncrypted, passphrase, encryptionMeta);
      await chrome.storage.local.set({ profile: { ...decrypted, encrypted: false } });
      loadProfile();
      showMessage('profileMessage', 'Profile decrypted.', 'success');
    } catch {
      showMessage('profileMessage', 'Decryption failed. Wrong passphrase?', 'error');
    }
    return;
  }

  // Encrypt
  const passphrase = prompt('Set a passphrase to encrypt your profile:');
  if (!passphrase) return;
  try {
    const { encrypted, meta } = await encryptData(profile, passphrase);
    await chrome.storage.local.set({
      profileEncrypted: encrypted,
      encryptionMeta: meta,
      profile: { ...profile, encrypted: true }
    });
    document.getElementById('encryptProfile').textContent = 'Unlock';
    showMessage('profileMessage', 'Profile encrypted.', 'success');
  } catch (err) {
    showMessage('profileMessage', `Encryption failed: ${err.message}`, 'error');
  }
});

async function deriveKey(passphrase, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptData(data, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(data))
  );
  return {
    encrypted: arrayBufferToBase64(encrypted),
    meta: { iv: arrayBufferToBase64(iv), salt: arrayBufferToBase64(salt) }
  };
}

async function decryptData(encryptedB64, passphrase, meta) {
  const salt = base64ToArrayBuffer(meta.salt);
  const iv = base64ToArrayBuffer(meta.iv);
  const key = await deriveKey(passphrase, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    base64ToArrayBuffer(encryptedB64)
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ── Autofill Tab ───────────────────────────────────────────────

async function loadAutofillStats() {
  const { stats } = await chrome.storage.local.get(['stats']);
  const dailyGoal = stats?.dailyGoal || 3;
  const today = new Date().toISOString().split('T')[0];
  const todayCount = stats?.daily?.[today] || 0;

  // Daily progress
  document.getElementById('dailyProgress').textContent = `${todayCount}/${dailyGoal}`;
  const pct = Math.min((todayCount / dailyGoal) * 100, 100);
  document.getElementById('progressFill').style.width = `${pct}%`;

  // Week count
  const weekCount = getLast7DaysCounts(stats?.daily || {}).reduce((a, b) => a + b, 0);
  document.getElementById('weekCount').textContent = weekCount;

  // Streak
  document.getElementById('streakCount').textContent = `${stats?.currentStreak || 0}d`;

  // Total
  document.getElementById('totalCount').textContent = stats?.totalAllTime || 0;

  // Sparkline
  const counts = getLast7DaysCounts(stats?.daily || {});
  renderSparkline(counts);
}

function getLast7DaysCounts(daily) {
  const counts = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    counts.push(daily[key] || 0);
  }
  return counts;
}

function renderSparkline(counts) {
  const max = Math.max(...counts, 1);
  const blocks = ['░', '▒', '▓', '█'];
  const sparkline = counts.map(c => {
    const idx = Math.min(Math.floor((c / max) * blocks.length), blocks.length - 1);
    return blocks[idx];
  }).join('');
  document.getElementById('sparkline').textContent = sparkline;
}

// Fill button
document.getElementById('fillFormBtn').addEventListener('click', async () => {
  const btn = document.getElementById('fillFormBtn');
  const msg = document.getElementById('autofillMessage');
  btn.disabled = true;
  btn.textContent = 'Filling...';
  showMessage('autofillMessage', 'Detecting forms on current page...', 'info');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found');

    // Ensure content script is injected (handles pages opened before extension load)
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (injectionErr) {
      // May fail on chrome:// pages or other restricted URLs
      throw new Error(`Cannot access this page (${injectionErr.message}). Try a regular web page.`);
    }

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'detectForms' });
    if (!response || response.length === 0) {
      showMessage('autofillMessage', 'No form fields detected on this page.', 'error');
      return;
    }

    showMessage('autofillMessage', `Found ${response.length} fields. Analyzing with AI...`, 'info');

    const fillResponse = await chrome.runtime.sendMessage({
      action: 'triggerFill',
      tabId: tab.id,
      formData: response
    });

    if (fillResponse?.success) {
      showMessage('autofillMessage', `Filled ${fillResponse.filledCount} fields successfully!`, 'success');
      loadAutofillStats();
    } else {
      showMessage('autofillMessage', fillResponse?.error || 'Fill failed.', 'error');
    }
  } catch (err) {
    showMessage('autofillMessage', `Error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Fill Current Form';
  }
});

// ── Stats Tab ──────────────────────────────────────────────────

async function loadStatsTab() {
  const { stats } = await chrome.storage.local.get(['stats']);
  document.getElementById('statTotal').textContent = stats?.totalAllTime || 0;
  document.getElementById('statStreak').textContent = stats?.currentStreak || 0;
  document.getElementById('dailyGoalInput').value = stats?.dailyGoal || 3;

  // Recent activity
  const list = document.getElementById('activityList');
  const daily = stats?.daily || {};
  const dates = Object.keys(daily).sort().reverse().slice(0, 14);

  if (dates.length === 0) {
    list.innerHTML = '<li class="activity-empty">No activity yet</li>';
  } else {
    list.innerHTML = dates.map(date => {
      const count = daily[date];
      const goal = stats?.dailyGoal || 3;
      const met = count >= goal ? ' ✓' : '';
      const metClass = count >= goal ? ' activity-goal-met' : '';
      return `<li><span>${date}</span><span class="${metClass}">${count} apps${met}</span></li>`;
    }).join('');
  }

  // Settings
  const { settings } = await chrome.storage.local.get(['settings']);
  if (settings) {
    document.getElementById('ollamaUrl').value = settings.ollamaUrl || 'http://localhost:11434';
    document.getElementById('ollamaModel').value = settings.ollamaModel || 'gemma4';
  }
}

// Set daily goal
document.getElementById('setGoalBtn').addEventListener('click', async () => {
  const goal = parseInt(document.getElementById('dailyGoalInput').value, 10);
  if (goal < 1 || goal > 20) {
    showMessage('statsMessage', 'Goal must be between 1 and 20.', 'error');
    return;
  }
  const { stats } = await chrome.storage.local.get(['stats']);
  const updated = { ...stats, dailyGoal: goal };
  await chrome.storage.local.set({ stats: updated });
  showMessage('statsMessage', `Daily goal set to ${goal}.`, 'success');
  loadAutofillStats();
  loadStatsTab();
});

// Save settings
document.getElementById('saveSettings').addEventListener('click', async () => {
  const settings = {
    ollamaUrl: document.getElementById('ollamaUrl').value.trim(),
    ollamaModel: document.getElementById('ollamaModel').value.trim()
  };
  await chrome.storage.local.set({ settings });
  showMessage('statsMessage', 'Settings saved.', 'success');
  checkOllamaStatus();
});

// ── Utility ────────────────────────────────────────────────────

function showMessage(elementId, text, type) {
  const el = document.getElementById(elementId);
  el.textContent = text;
  el.className = `message ${type}`;
  if (type !== 'error') {
    setTimeout(() => { el.className = 'message'; }, 4000);
  }
}

// ── Initialize ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  checkOllamaStatus();
  loadProfile();
  loadAutofillStats();
  loadStatsTab();
});
