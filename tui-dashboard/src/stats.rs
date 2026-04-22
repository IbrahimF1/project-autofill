//! Stats data types and aggregation logic for JobAutoFill TUI.

use chrono::{Local, TimeDelta};
use serde::Deserialize;
use std::collections::BTreeMap;

/// Raw stats structure as stored in Chrome's LevelDB.
#[derive(Debug, Deserialize, Default, Clone)]
pub struct RawStats {
    #[serde(default)]
    pub daily: BTreeMap<String, u32>,
    #[serde(default, rename = "totalAllTime")]
    pub total_all_time: u32,
    #[serde(default, rename = "currentStreak")]
    pub current_streak: u32,
    #[serde(default, rename = "dailyGoal")]
    pub daily_goal: u32,
}

/// Processed stats ready for display.
#[derive(Debug, Clone)]
pub struct Stats {
    #[allow(dead_code)]
    pub daily: BTreeMap<String, u32>,
    pub total_all_time: u32,
    pub current_streak: u32,
    pub daily_goal: u32,
    pub today_count: u32,
    pub week_count: u32,
    pub last_7_days: Vec<(String, u32)>,
    pub last_14_days: Vec<(String, u32)>,
}

impl Stats {
    pub fn from_raw(raw: RawStats) -> Self {
        let today = Local::now().format("%Y-%m-%d").to_string();
        let today_count = raw.daily.get(&today).copied().unwrap_or(0);

        let last_7_days = Self::last_n_days(&raw.daily, 7);
        let last_14_days = Self::last_n_days(&raw.daily, 14);

        let week_count: u32 = last_7_days.iter().map(|(_, c)| *c).sum();

        Self {
            daily: raw.daily,
            total_all_time: raw.total_all_time,
            current_streak: raw.current_streak,
            daily_goal: raw.daily_goal,
            today_count,
            week_count,
            last_7_days,
            last_14_days,
        }
    }

    /// Get the last N days of counts, filling in zeros for missing days.
    fn last_n_days(daily: &BTreeMap<String, u32>, n: usize) -> Vec<(String, u32)> {
        let mut result = Vec::with_capacity(n);
        let today = Local::now().date_naive();

        for i in (0..n).rev() {
            let date = today - TimeDelta::days(i as i64);
            let key = date.format("%Y-%m-%d").to_string();
            let count = daily.get(&key).copied().unwrap_or(0);
            // Short date label: "Apr 21"
            let label = date.format("%b %d").to_string();
            result.push((label, count));
        }
        result
    }

    /// Calculate streak from daily counts.
    #[allow(dead_code)]
    pub fn calculate_streak(daily: &BTreeMap<String, u32>) -> u32 {
        let today = Local::now().date_naive();
        let mut streak = 0u32;

        for i in 0..365 {
            let date = today - TimeDelta::days(i);
            let key = date.format("%Y-%m-%d").to_string();
            if let Some(&count) = daily.get(&key) {
                if count > 0 {
                    streak += 1;
                } else if i > 0 {
                    break;
                }
            } else if i > 0 {
                break;
            }
        }

        streak
    }

    /// Get sparkline data (last 7 days counts as raw u64 values).
    pub fn sparkline_data(&self) -> Vec<u64> {
        self.last_7_days.iter().map(|(_, c)| *c as u64).collect()
    }

    /// Get bar chart data (last 7 days).
    pub fn bar_chart_data(&self) -> Vec<(&str, u64)> {
        self.last_7_days
            .iter()
            .map(|(label, count)| (label.as_str(), *count as u64))
            .collect()
    }
}

impl Default for Stats {
    fn default() -> Self {
        Self::from_raw(RawStats::default())
    }
}
