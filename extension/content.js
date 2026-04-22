/**
 * JobAutoFill — Content Script
 * Detects form fields on the page, serializes form structure,
 * receives field mappings from background, and fills inputs.
 */

// ── Guard Against Re-injection ─────────────────────────────────
if (window.__jobAutoContentLoaded) {
  console.log('[JobAutoFill] Content script already loaded, skipping re-injection.');
} else {
  window.__jobAutoContentLoaded = true;

  // ── Message Handling ───────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'detectForms') {
      const fields = detectFormFields();
      sendResponse(fields);
      return false; // synchronous response
    }

    if (msg.action === 'fillFields') {
      const result = fillFields(msg.mappings);
      sendResponse(result);
      return false; // synchronous response
    }

    return false;
  });

  console.log(`[JobAutoFill] Content script loaded on ${location.href}`);
}

// ── Form Detection ─────────────────────────────────────────────

/**
 * Query all input, textarea, and select elements on the page,
 * serialize their metadata for Ollama analysis.
 * @returns {Array<Object>} Array of field descriptors
 */
function detectFormFields() {
  const inputs = document.querySelectorAll('input, textarea, select');
  return Array.from(inputs)
    .filter(el => isVisible(el) && !isHiddenInput(el))
    .map(el => ({
      selector: getUniqueSelector(el),
      tag: el.tagName.toLowerCase(),
      type: el.type || '',
      name: el.name || '',
      id: el.id || '',
      placeholder: el.placeholder || '',
      label: getAssociatedLabel(el),
      required: el.required,
      ariaLabel: el.getAttribute('aria-label') || '',
      options: el.tagName === 'SELECT' ? Array.from(el.options).map(o => o.text) : null
    }));
}

/**
 * Check if an element is visible on the page.
 */
function isVisible(el) {
  const style = window.getComputedStyle(el);
  return style.display !== 'none' &&
         style.visibility !== 'hidden' &&
         style.opacity !== '0' &&
         el.offsetWidth > 0 &&
         el.offsetHeight > 0;
}

/**
 * Check if an input is a hidden/submit/button type we should skip.
 */
function isHiddenInput(el) {
  const skipTypes = ['hidden', 'submit', 'button', 'reset', 'image', 'file'];
  return el.tagName === 'INPUT' && skipTypes.includes(el.type?.toLowerCase());
}

/**
 * Get the associated label text for a form element.
 */
function getAssociatedLabel(el) {
  // Check for explicit label via 'for' attribute
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return label.textContent.trim();
  }

  // Check for parent label
  const parentLabel = el.closest('label');
  if (parentLabel) {
    // Get text content minus child input text
    const clone = parentLabel.cloneNode(true);
    clone.querySelectorAll('input, textarea, select').forEach(c => c.remove());
    const text = clone.textContent.trim();
    if (text) return text;
  }

  // Check aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return labelEl.textContent.trim();
  }

  // Check preceding sibling text
  const prevSibling = el.previousElementSibling;
  if (prevSibling && prevSibling.tagName !== 'INPUT' && prevSibling.tagName !== 'SELECT') {
    const text = prevSibling.textContent.trim();
    if (text && text.length < 100) return text;
  }

  return '';
}

/**
 * Build a unique CSS selector for an element.
 */
function getUniqueSelector(el) {
  // Prefer id
  if (el.id) {
    return `#${CSS.escape(el.id)}`;
  }

  // Prefer name within context
  if (el.name) {
    const tag = el.tagName.toLowerCase();
    return `${tag}[name="${CSS.escape(el.name)}"]`;
  }

  // Build path from root
  const parts = [];
  let current = el;
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector = `#${CSS.escape(current.id)}`;
      parts.unshift(selector);
      break;
    }
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).filter(c => c && !c.startsWith('__'));
      if (classes.length > 0) {
        selector += `.${classes.map(c => CSS.escape(c)).join('.')}`;
      }
    }

    // Add nth-child for disambiguation
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        selector += `:nth-child(${idx})`;
      }
    }

    parts.unshift(selector);
    current = current.parentElement;
  }

  return parts.join(' > ');
}

// ── Field Filling ──────────────────────────────────────────────

/**
 * Apply field mappings to the page's form elements.
 * @param {Array<{selector: string, value: string}>} mappings
 * @returns {{ filledCount: number, totalAttempted: number, errors: string[] }}
 */
function fillFields(mappings) {
  const result = { filledCount: 0, totalAttempted: mappings.length, errors: [] };

  for (const { selector, value } of mappings) {
    try {
      const el = document.querySelector(selector);
      if (!el) {
        result.errors.push(`Element not found: ${selector}`);
        continue;
      }

      // Set value based on element type
      if (el.tagName === 'SELECT') {
        fillSelect(el, value);
      } else {
        el.value = value;
      }

      // Dispatch events to trigger any framework listeners
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));

      // Orange highlight
      el.style.boxShadow = '0 0 8px rgba(255, 149, 0, 0.6)';
      el.style.borderColor = '#ff9500';
      el.style.transition = 'box-shadow 0.3s, border-color 0.3s';

      // Fade highlight after 3 seconds
      setTimeout(() => {
        el.style.boxShadow = '';
        el.style.borderColor = '';
      }, 3000);

      result.filledCount++;
    } catch (err) {
      result.errors.push(`Error filling ${selector}: ${err.message}`);
    }
  }

  return result;
}

/**
 * Fill a select element by matching option text or value.
 */
function fillSelect(selectEl, value) {
  const lowerValue = value.toLowerCase().trim();

  // Try exact text match
  for (const option of selectEl.options) {
    if (option.text.toLowerCase().trim() === lowerValue) {
      selectEl.value = option.value;
      return;
    }
  }

  // Try contains text match
  for (const option of selectEl.options) {
    if (option.text.toLowerCase().includes(lowerValue)) {
      selectEl.value = option.value;
      return;
    }
  }

  // Try value match
  for (const option of selectEl.options) {
    if (option.value.toLowerCase().trim() === lowerValue) {
      selectEl.value = option.value;
      return;
    }
  }

  // Fallback: set value directly
  selectEl.value = value;
}
