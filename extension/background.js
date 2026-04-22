/**
 * JobAutoFill — Background Service Worker
 * Handles Ollama API proxy, daily reminders, stats tracking,
 * form mapping cache, and message routing.
 */

// ── Initialization ─────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    // Set default settings
    chrome.storage.local.set({
      settings: {
        ollamaUrl: 'http://localhost:11434',
        ollamaModel: 'gemma4'
      },
      stats: {
        daily: {},
        totalAllTime: 0,
        currentStreak: 0,
        dailyGoal: 3
      },
      formCache: {}
    });
    console.log('[JobAutoFill] Extension installed, defaults set.');
  }
});

// ── Message Router ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'triggerFill') {
    handleAutoFill(msg.tabId, msg.formData)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async
  }

  if (msg.action === 'analyzeForm') {
    analyzeForm(msg.formData, msg.profile)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  return false;
});

// ── Auto-Fill Orchestration ────────────────────────────────────

async function handleAutoFill(tabId, formData) {
  if (!formData || formData.length === 0) {
    return { success: false, error: 'No form fields provided.' };
  }

  // Get user profile
  const { profile } = await chrome.storage.local.get(['profile']);
  if (!profile || !profile.name) {
    return { success: false, error: 'No profile saved. Go to Profile tab first.' };
  }

  // Try to get cached mappings
  const domain = new URL((await chrome.tabs.get(tabId)).url).hostname;
  const formSignature = hashFormData(formData);
  const cached = await getCachedMapping(domain, formSignature);

  let mappings;
  if (cached) {
    console.log(`[JobAutoFill] Using cached mappings for ${domain}`);
    mappings = cached;
  } else {
    // Call Ollama for AI-powered mapping
    try {
      mappings = await analyzeForm(formData, profile);
    } catch (err) {
      console.warn(`[JobAutoFill] Ollama failed, using static fallback: ${err.message}`);
      mappings = staticFill(formData, profile);
    }

    // Cache the result
    await setCachedMapping(domain, formSignature, mappings);
  }

  // Send mappings to content script for filling
  const fillResult = await chrome.tabs.sendMessage(tabId, {
    action: 'fillFields',
    mappings
  });

  if (fillResult && fillResult.filledCount > 0) {
    await incrementStats();
    return { success: true, filledCount: fillResult.filledCount, errors: fillResult.errors };
  }

  return { success: false, error: 'No fields were filled.', errors: fillResult?.errors || [] };
}

// ── Ollama Integration ─────────────────────────────────────────

/**
 * Build the prompt for form analysis.
 */
function buildPrompt(formFields, profile) {
  const fieldList = formFields.map(f => {
    let desc = `<${f.tag}`;
    if (f.name) desc += ` name="${f.name}"`;
    if (f.type) desc += ` type="${f.type}"`;
    if (f.placeholder) desc += ` placeholder="${f.placeholder}"`;
    if (f.label) desc += ` label="${f.label}"`;
    if (f.ariaLabel) desc += ` aria-label="${f.ariaLabel}"`;
    if (f.options) desc += ` options="${f.options.join(', ')}"`;
    if (f.required) desc += ` required`;
    desc += '>';
    return `  ${desc}`;
  }).join('\n');

  return `You are a form-filling assistant. Map each form field to the appropriate user data.

Form fields detected on page:
${fieldList}

User profile:
- Name: ${profile.name || ''}
- Email: ${profile.email || ''}
- Phone: ${profile.phone || ''}
- LinkedIn: ${profile.linkedin || ''}
- Portfolio: ${profile.portfolio || ''}
- Skills: ${(profile.skills || []).join(', ')}
- Resume summary: ${(profile.resumeText || '').substring(0, 500)}

Output a JSON object with a single "mappings" array. Each item has "selector" (the CSS selector) and "value" (what to fill).
For free-text fields like cover letter or additional info, generate a brief professional response based on the resume.
Only fill fields where you can confidently determine the correct value.`;
}

/**
 * Call Ollama API to analyze form and generate field mappings.
 */
async function analyzeForm(formFields, profile) {
  const { settings } = await chrome.storage.local.get(['settings']);
  const url = settings?.ollamaUrl || 'http://localhost:11434';
  const model = settings?.ollamaModel || 'gemma4';

  const prompt = buildPrompt(formFields, profile);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: {
          type: 'object',
          properties: {
            mappings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  selector: { type: 'string' },
                  value: { type: 'string' }
                },
                required: ['selector', 'value']
              }
            }
          },
          required: ['mappings']
        },
        options: { temperature: 0.1 }
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status}`);
    }

    const data = await response.json();

    // Validate response
    if (!data.response) {
      throw new Error('Empty response from Ollama');
    }

    let parsed;
    try {
      parsed = JSON.parse(data.response);
    } catch {
      // Try extracting JSON from response text
      const jsonMatch = data.response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse Ollama response as JSON');
      }
    }

    if (!parsed.mappings || !Array.isArray(parsed.mappings)) {
      throw new Error('Ollama response missing "mappings" array');
    }

    // Validate each mapping has selector and value
    return parsed.mappings.filter(m => m.selector && typeof m.value === 'string');
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Ollama request timed out (30s)');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Static Fallback ────────────────────────────────────────────

/**
 * Regex-based static field matching when Ollama is unavailable.
 */
function staticFill(formData, profile) {
  const fieldPatterns = [
    { pattern: /name|full.?name|first.?name|your.?name/i, value: profile.name },
    { pattern: /last.?name|surname|family.?name/i, value: profile.name?.split(' ').pop() || '' },
    { pattern: /email|e-?mail|email.?address/i, value: profile.email },
    { pattern: /phone|tel|mobile|cell.?phone/i, value: profile.phone },
    { pattern: /linkedin|linked.?in/i, value: profile.linkedin },
    { pattern: /portfolio|website|url|blog/i, value: profile.portfolio },
    { pattern: /skill|technologies|expertise/i, value: (profile.skills || []).join(', ') },
    { pattern: /resume|cv|cover|summary|about|bio|experience/i, value: profile.resumeText }
  ];

  const mappings = [];

  for (const field of formData) {
    const searchText = [field.name, field.label, field.placeholder, field.ariaLabel, field.id]
      .filter(Boolean)
      .join(' ');

    for (const { pattern, value } of fieldPatterns) {
      if (pattern.test(searchText) && value) {
        mappings.push({ selector: field.selector, value });
        break; // first match wins
      }
    }
  }

  return mappings;
}

// ── Form Mapping Cache ─────────────────────────────────────────

/**
 * Generate a simple hash of form field signatures for cache keying.
 */
function hashFormData(formData) {
  const sig = formData.map(f => `${f.tag}:${f.name}:${f.type}:${f.label}`).join('|');
  let hash = 0;
  for (let i = 0; i < sig.length; i++) {
    const char = sig.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

async function getCachedMapping(domain, formSignature) {
  const cacheKey = `${domain}:${formSignature}`;
  const { formCache } = await chrome.storage.local.get(['formCache']);
  const cached = formCache?.[cacheKey];
  if (cached && Date.now() < cached.expires) {
    return cached.mappings;
  }
  return null;
}

async function setCachedMapping(domain, formSignature, mappings) {
  const { formCache } = await chrome.storage.local.get(['formCache']);
  const cacheKey = `${domain}:${formSignature}`;
  const updated = { ...(formCache || {}) };
  updated[cacheKey] = {
    mappings,
    timestamp: Date.now(),
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000 // 1 week
  };

  // Prune expired entries
  for (const [key, val] of Object.entries(updated)) {
    if (Date.now() >= val.expires) delete updated[key];
  }

  await chrome.storage.local.set({ formCache: updated });
}

// ── Stats Tracking ─────────────────────────────────────────────

async function incrementStats() {
  const today = new Date().toISOString().split('T')[0];
  const { stats } = await chrome.storage.local.get(['stats']);
  const updated = { ...(stats || { daily: {}, totalAllTime: 0, currentStreak: 0, dailyGoal: 3 }) };
  updated.daily[today] = (updated.daily[today] || 0) + 1;
  updated.totalAllTime = (updated.totalAllTime || 0) + 1;
  updated.currentStreak = calculateStreak(updated.daily);
  await chrome.storage.local.set({ stats: updated });
}

function calculateStreak(daily) {
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    if (daily[key] && daily[key] > 0) {
      streak++;
    } else if (i > 0) {
      // Allow today to be empty (streak not broken yet)
      break;
    }
  }
  return streak;
}

// ── Daily Reminders ────────────────────────────────────────────

chrome.alarms.create('dailyRemind', { delayInMinutes: 1, periodInMinutes: 1440 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'dailyRemind') {
    chrome.storage.local.get(['stats'], ({ stats }) => {
      const today = new Date().toISOString().split('T')[0];
      const count = stats?.daily?.[today] || 0;
      const goal = stats?.dailyGoal || 3;
      if (count < goal) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'assets/128.png',
          title: 'JobAutoFill Reminder',
          message: `You've filled ${count}/${goal} applications today. Keep going!`
        });
      }
    });
  }
});

// ── Service Worker Heartbeat ───────────────────────────────────

let heartbeatInterval;

async function startHeartbeat() {
  await chrome.storage.local.set({ 'last-heartbeat': Date.now() });
  heartbeatInterval = setInterval(async () => {
    await chrome.storage.local.set({ 'last-heartbeat': Date.now() });
  }, 20000);
}

function stopHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
}

// Start heartbeat on startup
chrome.runtime.onStartup.addListener(() => {
  startHeartbeat();
});

// Start heartbeat on install
chrome.runtime.onInstalled.addListener(() => {
  startHeartbeat();
});

console.log('[JobAutoFill] Background service worker loaded.');
