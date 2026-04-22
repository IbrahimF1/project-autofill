//! Ratatui rendering functions for the JobAutoFill TUI dashboard.
//!
//! Orange glow theme matching the Chrome extension's design.

use crate::app::{App, Tab};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{
    Bar, BarChart, Block, Borders, Gauge, Paragraph, Sparkline, Tabs, Wrap,
};
use ratatui::Frame;

// ── Orange Theme Colors ────────────────────────────────────────

const ORANGE: Color = Color::Rgb(255, 149, 0);
const ORANGE_DIM: Color = Color::Rgb(204, 119, 0);
const ORANGE_GLOW: Color = Color::Rgb(255, 180, 50);
const BG_DARK: Color = Color::Rgb(30, 30, 30);
const BG_DARKER: Color = Color::Rgb(26, 26, 26);
const TEXT_DIM: Color = Color::Rgb(136, 136, 136);
const SUCCESS: Color = Color::Rgb(76, 175, 80);

// ── Main Render ────────────────────────────────────────────────

pub fn render(frame: &mut Frame, app: &App) {
    let outer_block = Block::default()
        .title(" JobAutoFill Dashboard ")
        .title_style(Style::default().fg(ORANGE).add_modifier(Modifier::BOLD))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(ORANGE_DIM))
        .style(Style::default().bg(BG_DARK));

    let inner = outer_block.inner(frame.area());
    frame.render_widget(outer_block, frame.area());

    // Split into: tabs | content | footer
    let chunks = Layout::vertical([
        Constraint::Length(3), // Tabs
        Constraint::Min(0),   // Content
        Constraint::Length(1), // Footer
    ])
    .split(inner);

    render_tabs(frame, app, chunks[0]);

    match app.tab {
        Tab::Overview => render_overview(frame, app, chunks[1]),
        Tab::Daily => render_daily(frame, app, chunks[1]),
        Tab::Settings => render_settings(frame, app, chunks[1]),
    }

    render_footer(frame, app, chunks[2]);
}

// ── Tabs ───────────────────────────────────────────────────────

fn render_tabs(frame: &mut Frame, app: &App, area: Rect) {
    let tab_titles: Vec<Line> = Tab::ALL
        .iter()
        .enumerate()
        .map(|(i, title)| {
            let style = if i == app.tab.index() {
                Style::default().fg(ORANGE).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(TEXT_DIM)
            };
            Line::from(Span::styled(*title, style))
        })
        .collect();

    let tabs = Tabs::new(tab_titles)
        .block(
            Block::default()
                .borders(Borders::BOTTOM)
                .border_style(Style::default().fg(ORANGE_DIM)),
        )
        .divider(Span::styled(" | ", Style::default().fg(TEXT_DIM)));

    frame.render_widget(tabs, area);
}

// ── Overview Tab ───────────────────────────────────────────────

fn render_overview(frame: &mut Frame, app: &App, area: Rect) {
    let chunks = Layout::vertical([
        Constraint::Length(4), // Progress + stats row
        Constraint::Length(3), // Sparkline
        Constraint::Min(0),   // Bar chart
    ])
    .split(area);

    render_progress_row(frame, app, chunks[0]);
    render_sparkline(frame, app, chunks[1]);
    render_bar_chart(frame, app, chunks[2]);
}

fn render_progress_row(frame: &mut Frame, app: &App, area: Rect) {
    let chunks = Layout::vertical([
        Constraint::Length(2), // Progress bar
        Constraint::Length(2), // Stats text
    ])
    .split(area);

    // Daily progress gauge
    let goal = app.stats.daily_goal.max(1);
    let ratio = (app.stats.today_count as f64 / goal as f64).min(1.0);
    let label = format!("{}/{} Today", app.stats.today_count, app.stats.daily_goal);

    let gauge = Gauge::default()
        .gauge_style(
            Style::default()
                .fg(ORANGE)
                .bg(BG_DARKER)
                .add_modifier(Modifier::BOLD),
        )
        .label(Span::styled(
            &label,
            Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
        ))
        .ratio(ratio);
    frame.render_widget(gauge, chunks[0]);

    // Stats text row
    let stats_line = Line::from(vec![
        Span::styled(
            format!(" Week: {} ", app.stats.week_count),
            Style::default().fg(ORANGE),
        ),
        Span::styled(
            format!(" Streak: {}d ", app.stats.current_streak),
            Style::default().fg(ORANGE_GLOW),
        ),
        Span::styled(
            format!(" Total: {} ", app.stats.total_all_time),
            Style::default().fg(ORANGE_DIM),
        ),
    ]);
    let stats_para = Paragraph::new(stats_line).style(Style::default().bg(BG_DARK));
    frame.render_widget(stats_para, chunks[1]);
}

fn render_sparkline(frame: &mut Frame, app: &App, area: Rect) {
    let data = app.stats.sparkline_data();

    let sparkline = Sparkline::default()
        .block(
            Block::default()
                .title(" Last 7 Days ")
                .title_style(Style::default().fg(TEXT_DIM))
                .borders(Borders::NONE)
                .style(Style::default().bg(BG_DARK)),
        )
        .data(&data)
        .style(Style::default().fg(ORANGE));

    frame.render_widget(sparkline, area);
}

fn render_bar_chart(frame: &mut Frame, app: &App, area: Rect) {
    let bar_data = app.stats.bar_chart_data();

    let bars: Vec<Bar> = bar_data
        .iter()
        .map(|(label, value)| {
            Bar::with_label(*label, *value).style(Style::default().fg(ORANGE))
        })
        .collect();

    let max_val = bar_data
        .iter()
        .map(|(_, v)| *v)
        .max()
        .unwrap_or(1)
        .max(1);

    let chart = BarChart::vertical(bars)
        .block(
            Block::default()
                .title(" Weekly Applications ")
                .title_style(Style::default().fg(TEXT_DIM))
                .borders(Borders::TOP)
                .border_style(Style::default().fg(ORANGE_DIM))
                .style(Style::default().bg(BG_DARK)),
        )
        .bar_width(5)
        .bar_gap(2)
        .max(max_val);

    frame.render_widget(chart, area);
}

// ── Daily Tab ──────────────────────────────────────────────────

fn render_daily(frame: &mut Frame, app: &App, area: Rect) {
    let items: Vec<Line> = app
        .stats
        .last_14_days
        .iter()
        .map(|(date, count)| {
            let goal = app.stats.daily_goal;
            let met = *count >= goal;
            let check = if met { " ✓" } else { "" };
            let style = if met {
                Style::default().fg(SUCCESS)
            } else {
                Style::default().fg(Color::White)
            };
            let count_style = if met {
                Style::default().fg(SUCCESS).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(ORANGE)
            };

            Line::from(vec![
                Span::styled(format!(" {:<12}", date), style),
                Span::styled(format!("{:>3} apps", count), count_style),
                Span::styled(check.to_string(), Style::default().fg(SUCCESS)),
            ])
        })
        .collect();

    let paragraph = Paragraph::new(items)
        .block(
            Block::default()
                .title(" Recent Activity (Last 14 Days) ")
                .title_style(Style::default().fg(TEXT_DIM))
                .borders(Borders::ALL)
                .border_style(Style::default().fg(ORANGE_DIM))
                .style(Style::default().bg(BG_DARK)),
        )
        .wrap(Wrap { trim: true });

    frame.render_widget(paragraph, area);
}

// ── Settings Tab ───────────────────────────────────────────────

fn render_settings(frame: &mut Frame, _app: &App, area: Rect) {
    let chunks = Layout::vertical([
        Constraint::Length(8), // Keybindings
        Constraint::Min(0),   // Info
    ])
    .split(area);

    // Keybindings
    let keys = vec![
        Line::from(vec![
            Span::styled("  [1/F1]  ", Style::default().fg(ORANGE).add_modifier(Modifier::BOLD)),
            Span::styled("Overview tab", Style::default().fg(Color::White)),
        ]),
        Line::from(vec![
            Span::styled("  [2/F2]  ", Style::default().fg(ORANGE).add_modifier(Modifier::BOLD)),
            Span::styled("Daily activity tab", Style::default().fg(Color::White)),
        ]),
        Line::from(vec![
            Span::styled("  [3/F3]  ", Style::default().fg(ORANGE).add_modifier(Modifier::BOLD)),
            Span::styled("Settings tab (this)", Style::default().fg(Color::White)),
        ]),
        Line::from(vec![
            Span::styled("  [Tab]   ", Style::default().fg(ORANGE).add_modifier(Modifier::BOLD)),
            Span::styled("Next tab", Style::default().fg(Color::White)),
        ]),
        Line::from(vec![
            Span::styled("  [↑/↓]   ", Style::default().fg(ORANGE).add_modifier(Modifier::BOLD)),
            Span::styled("Scroll", Style::default().fg(Color::White)),
        ]),
        Line::from(vec![
            Span::styled("  [q/Esc] ", Style::default().fg(ORANGE).add_modifier(Modifier::BOLD)),
            Span::styled("Quit", Style::default().fg(Color::White)),
        ]),
    ];

    let keys_para = Paragraph::new(keys)
        .block(
            Block::default()
                .title(" Keybindings ")
                .title_style(Style::default().fg(TEXT_DIM))
                .borders(Borders::ALL)
                .border_style(Style::default().fg(ORANGE_DIM))
                .style(Style::default().bg(BG_DARK)),
        )
        .wrap(Wrap { trim: true });
    frame.render_widget(keys_para, chunks[0]);

    // Info
    let info = vec![
        Line::from(""),
        Line::from(Span::styled(
            "  Data is read directly from Chrome's LevelDB storage.",
            Style::default().fg(TEXT_DIM),
        )),
        Line::from(Span::styled(
            "  The dashboard auto-refreshes when Chrome writes new data.",
            Style::default().fg(TEXT_DIM),
        )),
        Line::from(""),
        Line::from(Span::styled(
            "  Run with --help for CLI options.",
            Style::default().fg(TEXT_DIM),
        )),
    ];

    let info_para = Paragraph::new(info)
        .block(
            Block::default()
                .title(" About ")
                .title_style(Style::default().fg(TEXT_DIM))
                .borders(Borders::ALL)
                .border_style(Style::default().fg(ORANGE_DIM))
                .style(Style::default().bg(BG_DARK)),
        )
        .wrap(Wrap { trim: true });
    frame.render_widget(info_para, chunks[1]);
}

// ── Footer ─────────────────────────────────────────────────────

fn render_footer(frame: &mut Frame, app: &App, area: Rect) {
    let updated = app
        .last_updated
        .as_deref()
        .unwrap_or("waiting for data...");

    let status = if app.status_message.is_empty() {
        String::new()
    } else {
        format!(" {} ", app.status_message)
    };

    let footer = Line::from(vec![
        Span::styled(
            " [1-3] Tabs  [q] Quit ",
            Style::default().fg(TEXT_DIM),
        ),
        Span::styled(
            format!("  Last updated: {} ", updated),
            Style::default().fg(ORANGE_DIM),
        ),
        Span::styled(status, Style::default().fg(SUCCESS)),
    ]);

    let para = Paragraph::new(footer).style(Style::default().bg(BG_DARKER));
    frame.render_widget(para, area);
}
