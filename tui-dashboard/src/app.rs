//! Application state and event handling for the TUI dashboard.

use crate::stats::{RawStats, Stats};
use crossterm::event::{KeyCode, KeyEvent};

/// Active tab in the dashboard.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tab {
    Overview,
    Daily,
    Settings,
}

impl Tab {
    pub const ALL: [&str; 3] = ["Overview", "Daily", "Settings"];

    pub fn index(self) -> usize {
        match self {
            Tab::Overview => 0,
            Tab::Daily => 1,
            Tab::Settings => 2,
        }
    }

    pub fn from_index(i: usize) -> Self {
        match i {
            0 => Tab::Overview,
            1 => Tab::Daily,
            _ => Tab::Settings,
        }
    }
}

/// Main application state.
pub struct App {
    pub stats: Stats,
    pub tab: Tab,
    pub should_quit: bool,
    pub last_updated: Option<String>,
    pub scroll_offset: u16,
    pub status_message: String,
}

impl App {
    pub fn new(stats: Stats) -> Self {
        Self {
            stats,
            tab: Tab::Overview,
            should_quit: false,
            scroll_offset: 0,
            last_updated: None,
            status_message: String::new(),
        }
    }

    /// Update stats from a fresh LevelDB read.
    pub fn update_stats(&mut self, raw: RawStats) {
        self.last_updated = Some(chrono::Local::now().format("%H:%M:%S").to_string());
        self.stats = Stats::from_raw(raw);
    }

    /// Handle a keyboard event.
    pub fn handle_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Char('q') | KeyCode::Esc => {
                self.should_quit = true;
            }
            KeyCode::Char('1') | KeyCode::F(1) => {
                self.tab = Tab::Overview;
            }
            KeyCode::Char('2') | KeyCode::F(2) => {
                self.tab = Tab::Daily;
            }
            KeyCode::Char('3') | KeyCode::F(3) => {
                self.tab = Tab::Settings;
            }
            KeyCode::Tab => {
                let next = (self.tab.index() + 1) % Tab::ALL.len();
                self.tab = Tab::from_index(next);
            }
            KeyCode::BackTab => {
                let prev = if self.tab.index() == 0 {
                    Tab::ALL.len() - 1
                } else {
                    self.tab.index() - 1
                };
                self.tab = Tab::from_index(prev);
            }
            KeyCode::Down => {
                self.scroll_offset = self.scroll_offset.saturating_add(1);
            }
            KeyCode::Up => {
                self.scroll_offset = self.scroll_offset.saturating_sub(1);
            }
            _ => {}
        }
    }
}
