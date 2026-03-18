# Project Autofill

https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/tutorial.hello-world

## Running This Extension

1. Clone this repository.
2. Load this directory in Chrome as an [unpacked extension](https://developer.chrome.com/docs/extensions/mv3/getstarted/development-basics/#load-unpacked).
3. Click the extension icon in the Chrome toolbar, then select the "Hello Extensions" extension. A popup will appear displaying the text "Hello Extensions".

## File Structure

- **manifest.json** - Extension configuration file defining metadata, permissions, and which scripts to load
- **background.js** - Service worker that runs in the background, handling extension lifecycle events (e.g., installation)
- **content.js** - Script injected into web pages matching the URL patterns, runs in page context
- **popup.html** - HTML markup for the extension popup UI displayed when clicking the extension icon
- **popup.js** - JavaScript logic for the popup interface
- **popup.css** - CSS reset and base styles for the popup UI
- **assets/** - Directory containing extension icons (16x16, 48x48, 128x128 pixels)