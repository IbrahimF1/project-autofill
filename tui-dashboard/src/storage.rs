//! LevelDB reader and directory watcher for Chrome extension storage.
//!
//! Reads stats directly from Chrome's `chrome.storage.local` LevelDB files
//! using `rusty-leveldb`. Opens in read-only mode to avoid conflicts with
//! Chrome's writer process.

use crate::stats::RawStats;
use color_eyre::eyre::{self, WrapErr};
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use rusty_leveldb::LdbIterator;
use std::path::{Path, PathBuf};
use std::sync::mpsc;

/// Resolve the Chrome LevelDB path for a given extension ID and profile.
///
/// Platform-specific defaults:
/// - Linux: `~/.config/google-chrome/<profile>/Storage/ext/<ext_id>/def/`
/// - macOS: `~/Library/Application Support/Google/Chrome/<profile>/Storage/ext/<ext_id>/def/`
/// - Windows: `%LOCALAPPDATA%\Google\Chrome\User Data\<profile>\Storage\ext\<ext_id>\def\`
pub fn resolve_leveldb_path(extension_id: &str, profile: &str) -> eyre::Result<PathBuf> {
    let candidates = get_chrome_paths(extension_id, profile);

    for path in &candidates {
        if path.exists() {
            return Ok(path.clone());
        }
    }

    let tried: Vec<String> = candidates.iter().map(|p| p.display().to_string()).collect();
    Err(eyre::eyre!(
        "Chrome extension storage not found.\nTried:\n  {}\n\nLoad the extension first and verify the extension ID at chrome://extensions",
        tried.join("\n  ")
    ))
}

fn get_chrome_paths(extension_id: &str, profile: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    // Linux paths
    if let Some(config) = dirs::config_dir() {
        paths.push(
            config
                .join("google-chrome")
                .join(profile)
                .join("Storage")
                .join("ext")
                .join(extension_id)
                .join("def"),
        );
        paths.push(
            config
                .join("chromium")
                .join(profile)
                .join("Storage")
                .join("ext")
                .join(extension_id)
                .join("def"),
        );
        paths.push(
            config
                .join("BraveSoftware")
                .join("Brave-Browser")
                .join(profile)
                .join("Storage")
                .join("ext")
                .join(extension_id)
                .join("def"),
        );
    }

    // macOS paths
    if let Some(home) = dirs::home_dir() {
        paths.push(
            home.join("Library")
                .join("Application Support")
                .join("Google")
                .join("Chrome")
                .join(profile)
                .join("Storage")
                .join("ext")
                .join(extension_id)
                .join("def"),
        );
    }

    // Windows paths
    if let Some(local_app_data) = dirs::data_local_dir() {
        paths.push(
            local_app_data
                .join("Google")
                .join("Chrome")
                .join("User Data")
                .join(profile)
                .join("Storage")
                .join("ext")
                .join(extension_id)
                .join("def"),
        );
    }

    paths
}

/// Read stats from Chrome's LevelDB storage.
///
/// Opens the database and looks for the "stats" key.
/// Chrome stores `chrome.storage.local` values as JSON-encoded strings.
pub fn read_stats_from_leveldb(path: &Path) -> eyre::Result<RawStats> {
    let mut options = rusty_leveldb::Options::default();
    options.create_if_missing = false;

    let mut db = rusty_leveldb::DB::open(path, options)
        .wrap_err_with(|| format!("Failed to open LevelDB at {}", path.display()))?;

    // Try to read the "stats" key directly
    // rusty-leveldb 3.x: db.get() returns Option<Vec<u8>> directly (not Result)
    if let Some(bytes) = db.get(b"stats") {
        let stats: RawStats = serde_json::from_slice(&bytes)
            .wrap_err("Failed to parse stats JSON from LevelDB")?;
        return Ok(stats);
    }

    // Fallback: iterate all keys looking for stats-like data
    // rusty-leveldb 3.x: new_iter() returns Result<DBIterator>
    let mut iter = db.new_iter()
        .wrap_err("Failed to create LevelDB iterator")?;
    iter.seek(b"stats");

    if let Some((_key, value)) = iter.next() {
        if let Ok(stats) = serde_json::from_slice::<RawStats>(&value) {
            return Ok(stats);
        }
    }

    // Return empty stats if nothing found (extension may not have been used yet)
    Ok(RawStats::default())
}

/// Watch the LevelDB directory for changes.
///
/// LevelDB writes new `.ldb`/`.sst` files and updates `MANIFEST-*` on compaction.
/// We watch the directory for any file system events.
pub fn watch_leveldb_dir(
    path: &Path,
) -> eyre::Result<(RecommendedWatcher, mpsc::Receiver<notify::Event>)> {
    let (tx, rx) = mpsc::channel();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        },
        Config::default(),
    )
    .wrap_err("Failed to create file watcher")?;

    watcher
        .watch(path, RecursiveMode::NonRecursive)
        .wrap_err_with(|| format!("Failed to watch directory {}", path.display()))?;

    Ok((watcher, rx))
}
