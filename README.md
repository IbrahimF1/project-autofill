# JobAutoFill — Local AI-Powered Job Application Auto-Filler

A Chrome extension paired with a Ratatui TUI dashboard for automated job application form filling using Ollama's Gemma 4 model. **All data stays local** — no cloud transmission, no external APIs.

## Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Chrome Extension │────▶│   Ollama Server   │     │   TUI Dashboard   │
│  (Manifest V3)    │     │   (localhost)      │     │   (Ratatui/Rust)  │
│                   │     │                    │     │                    │
│ • popup.html/js   │     │ • gemma4 model     │     │ • Bar charts       │
│ • content.js      │     │ • /api/generate    │     │ • Sparklines       │
│ • background.js   │     │ • Structured JSON  │     │ • Daily tracking   │
└────────┬─────────┘     └──────────────────┘     └────────┬─────────┘
         │                                                  │
         │           ┌──────────────────────┐               │
         └──────────▶│  chrome.storage.local │◀──────────────┘
                     │  (LevelDB on disk)    │
                     └──────────────────────┘
```

**Communication flow**: Extension → Ollama (localhost fetch) for AI inference. TUI reads Chrome's LevelDB storage files directly using `rusty-leveldb` with filesystem watcher for live updates.

## Prerequisites

- **Google Chrome** (or Chromium/Brave)
- **Ollama** — [install](https://ollama.ai) for local LLM inference
- **Rust toolchain** — for building the TUI dashboard (`rustup`)
- **~5GB VRAM** (recommended) or CPU fallback for Gemma 4

## Setup

### 1. Install Ollama & Pull Model

```bash
# Install Ollama (Linux)
curl -fsSL https://ollama.ai/install.sh | sh

# Start the server
ollama serve

# Pull Gemma 4 (quantized, ~5GB)
ollama pull gemma4
```

Verify it's running:
```bash
curl http://localhost:11434/api/tags
```

### 2. Load the Chrome Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `extension/` directory from this project
5. Note the **Extension ID** shown on the card (needed for TUI dashboard)
6. Pin the extension to your toolbar

### 3. Build the TUI Dashboard

```bash
cd tui-dashboard
cargo build --release
```

## Usage

### Chrome Extension

1. **Click the extension icon** in the Chrome toolbar
2. **Profile tab**: Enter your name, email, phone, LinkedIn, portfolio, skills, and resume text. Click **Save Profile**.
3. **Autofill tab**: Navigate to a job application form, then click **▶ Fill Form**. The extension will:
   - Detect all form fields on the page
   - Send the form HTML to Ollama for AI-powered field mapping
   - Fill in your profile data automatically
   - Highlight filled fields in orange
4. **Stats tab**: View your daily/weekly application counts, streak, and sparkline history

**Settings**: The Ollama endpoint defaults to `http://localhost:11434`. Change it in the Autofill tab if needed.

### TUI Dashboard

```bash
# Auto-detect Chrome storage path (requires extension ID)
cargo run --release -- --extension-id <YOUR_EXTENSION_ID>

# Or specify the full LevelDB path directly
cargo run --release -- --leveldb-path /path/to/chrome/Storage/ext/<id>/def

# Custom Chrome profile (default: "Default")
cargo run --release -- --extension-id <ID> --profile "Profile 1"

# Custom poll interval (seconds, default: 30)
cargo run --release -- --extension-id <ID> --poll-interval 10
```

**Platform-specific Chrome storage paths**:

| Platform | Path |
|----------|------|
| Linux | `~/.config/google-chrome/<profile>/Storage/ext/<ext_id>/def/` |
| macOS | `~/Library/Application Support/Google/Chrome/<profile>/Storage/ext/<ext_id>/def/` |
| Windows | `%LOCALAPPDATA%\Google\Chrome\User Data\<profile>\Storage\ext\<ext_id>\def\` |

**TUI Keybindings**:

| Key | Action |
|-----|--------|
| `1` / `F1` | Overview tab (progress, sparkline, bar chart) |
| `2` / `F2` | Daily activity tab (14-day history) |
| `3` / `F3` | Settings tab (keybindings, about) |
| `Tab` / `Shift+Tab` | Cycle tabs |
| `↑` / `↓` | Scroll |
| `q` / `Esc` | Quit |

## File Structure

```
extension/
├── manifest.json      # Manifest V3 config with permissions
├── popup.html         # Tabbed UI: Profile / Autofill / Stats
├── popup.css          # Orange glow theme (#ff9500)
├── popup.js           # Profile CRUD, Ollama status, autofill trigger, stats
├── content.js         # DOM form detection, field serialization, value filling
├── background.js      # Ollama proxy, alarms, stats tracking, caching
└── assets/            # Extension icons (16, 48, 128px)

tui-dashboard/
├── Cargo.toml         # Rust dependencies
└── src/
    ├── main.rs        # CLI args, event loop, file watcher
    ├── app.rs         # Application state, key handling
    ├── ui.rs          # Ratatui rendering (orange theme)
    ├── stats.rs       # Stats data structures, aggregation
    └── storage.rs     # LevelDB reader, directory watcher

plans/
└── architecture.md    # Detailed architecture documentation
```

## Features

- **AI-Powered Form Mapping**: Uses Ollama's Gemma 4 with structured JSON output to intelligently map profile fields to form inputs
- **Offline Fallback**: Static regex-based filling when Ollama is unavailable
- **Form Mapping Cache**: Caches AI responses per domain (weekly expiry) to reduce latency
- **Cross-Frame Support**: Content scripts inject into all frames (`all_frames: true`) for iframe-based forms
- **Encrypted Storage**: Optional profile encryption using Web Crypto API (PBKDF2 + AES-GCM)
- **Daily Reminders**: `chrome.alarms` notifications to maintain application streaks
- **Live Dashboard**: Filesystem watcher updates the TUI in real-time as Chrome writes to LevelDB
- **Privacy-First**: All data stays on localhost. No network calls except to local Ollama instance

## Design Theme

Orange glow "sunset terminal" aesthetic:
- **Primary**: `#ff9500` (orange accent)
- **Secondary**: `#cc7700` (dim orange)
- **Background**: `#1e1e1e` (dark)
- **Text**: `#ffffff` (white), `#888888` (dim)
- **Font**: Monospace (`'Roboto Mono', monospace`)
- **Effects**: Orange glow borders, `box-shadow` highlights

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Ollama connection failed | Run `ollama serve` and verify with `curl http://localhost:11434/api/tags` |
| Extension can't connect to Ollama | Check `host_permissions` in manifest.json includes `http://localhost:11434/*` |
| TUI shows "storage not found" | Verify extension ID at `chrome://extensions/` and ensure the extension has been used at least once |
| Forms not detected | Some sites use shadow DOM; the content script handles standard DOM only |
| Slow filling (>10s) | Ensure GPU is available for Ollama; quantized model (`gemma4:4b`) is faster |
| Service worker inactive | Chrome may throttle MV3 workers; the extension uses heartbeat pings every 20s |

## License

MIT
