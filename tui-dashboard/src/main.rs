//! JobAutoFill TUI Dashboard
//!
//! Reads application stats directly from Chrome's LevelDB storage
//! and displays them in a terminal dashboard with orange glow theme.

mod app;
mod stats;
mod storage;
mod ui;

use app::App;
use clap::Parser;
use stats::{RawStats, Stats};
use std::path::PathBuf;
use std::time::Duration;

#[derive(Parser)]
#[command(
    name = "tui-dashboard",
    about = "TUI dashboard for JobAutoFill Chrome extension",
    long_about = "Displays job application statistics read directly from Chrome's LevelDB storage.\n\
                  All data stays local — reads chrome.storage.local via rusty-leveldb."
)]
struct Cli {
    /// Chrome extension ID — found at chrome://extensions after loading the unpacked extension
    #[arg(long, short = 'e')]
    extension_id: Option<String>,

    /// Chrome profile name (default: "Default")
    #[arg(long, short = 'p', default_value = "Default")]
    profile: String,

    /// Direct path to Chrome's LevelDB directory — overrides auto-detection
    #[arg(long, short = 'd')]
    leveldb_path: Option<PathBuf>,

    /// Poll interval in seconds when no file watcher events received
    #[arg(long, default_value = "5")]
    poll_interval: u64,
}

fn main() -> color_eyre::Result<()> {
    color_eyre::install()?;
    let cli = Cli::parse();

    // Resolve LevelDB path
    let leveldb_path = match &cli.leveldb_path {
        Some(p) => p.clone(),
        None => {
            let ext_id = cli
                .extension_id
                .as_deref()
                .ok_or_else(|| color_eyre::eyre::eyre!(
                    "Provide --extension-id <ID> or --leveldb-path <PATH>\n\n\
                     Find the extension ID at chrome://extensions after loading the unpacked extension.\n\
                     Example: tui-dashboard --extension-id abcdefghijklmnopqrstuvwxyzabcdef"
                ))?;
            storage::resolve_leveldb_path(ext_id, &cli.profile)?
        }
    };

    // Initial stats read
    let raw_stats = storage::read_stats_from_leveldb(&leveldb_path)
        .unwrap_or_else(|e| {
            eprintln!("Warning: Could not read LevelDB: {e}");
            eprintln!("Starting with empty stats. The dashboard will auto-refresh when data becomes available.");
            RawStats::default()
        });

    // Initialize terminal
    let mut terminal = ratatui::init();
    let mut app = App::new(Stats::from_raw(raw_stats));
    app.last_updated = Some(chrono::Local::now().format("%H:%M:%S").to_string());

    // Set up LevelDB directory watcher
    let watch_result = storage::watch_leveldb_dir(&leveldb_path);
    let watch_rx = match watch_result {
        Ok((_watcher, rx)) => {
            // Keep watcher alive for the duration of the program
            std::mem::forget(_watcher);
            Some(rx)
        }
        Err(e) => {
            eprintln!("Warning: File watcher failed: {e}");
            eprintln!("Falling back to polling every {}s", cli.poll_interval);
            None
        }
    };

    let poll_duration = Duration::from_millis(100);
    let mut poll_counter = 0u64;
    let poll_ticks = cli.poll_interval * 10; // 100ms ticks per poll

    // Main event loop
    loop {
        terminal.draw(|f| ui::render(f, &app))?;

        // Handle terminal input
        if crossterm::event::poll(poll_duration)? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                app.handle_key(key);
            }
        }

        // Check for LevelDB changes from watcher
        if let Some(ref rx) = watch_rx {
            while let Ok(_event) = rx.try_recv() {
                if let Ok(raw) = storage::read_stats_from_leveldb(&leveldb_path) {
                    app.update_stats(raw);
                }
            }
        }

        // Fallback polling if no watcher or as a safety net
        poll_counter += 1;
        if poll_counter >= poll_ticks {
            poll_counter = 0;
            if let Ok(raw) = storage::read_stats_from_leveldb(&leveldb_path) {
                app.update_stats(raw);
            }
        }

        if app.should_quit {
            break;
        }
    }

    ratatui::restore();
    Ok(())
}
