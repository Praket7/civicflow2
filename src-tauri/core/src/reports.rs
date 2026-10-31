//! Report read models and local exports.
//!
//! Reports are built from the same SQLite rows the screens read, not from
//! browser-side arithmetic. CSV escaping and the PDF writer are covered by
//! unit tests because a report that loses a comma or a page is a data bug.

use std::fs;
use std::path::Path;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};
use crate::models::RetentionCohort;
use crate::services::now;
use crate::workflows::retention_cohorts;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportRequest {
    #[serde(default = "default_template")]
    pub template: String,
    #[serde(default)]
    pub fields: Vec<String>,
    pub date_start: Option<String>,
    pub date_end: Option<String>,
    pub cause: Option<String>,
    #[serde(default = "default_grouping")]
    pub group_by: String,
}

fn default_template() -> String {
    "custom".into()
}

fn default_grouping() -> String {
    "none".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReportSummaryItem {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReportDocument {
    pub template: String,
    pub title: String,
    pub organization: String,
    pub period: String,
    pub generated_at: String,
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub summary: Vec<ReportSummaryItem>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ExportFormat {
    Csv,
    Pdf,
}

impl ExportFormat {
    pub fn parse(value: &str) -> Result<Self> {
        match value.to_ascii_lowercase().as_str() {
            "csv" => Ok(Self::Csv),
            "pdf" => Ok(Self::Pdf),
            other => Err(CoreError::Validation(format!(
                "Unsupported export format: {other}"
            ))),
        }
    }
}

fn title_for(template: &str) -> &'static str {
    match template {
        "participation" => "Volunteer participation",
        "coverage" => "Coverage by program",
        "attendance" => "Attendance and no-shows",
        "retention" => "Retention and engagement",
        "skills" | "credentials" => "Credentials and skills",
        "impact" => "Community impact",
        _ => "Custom report",
    }
}

fn organization(conn: &Connection) -> Result<String> {
    // The report names the workspace it was generated for.
    let scoped: Option<String> = conn
        .query_row(
            "SELECT name FROM organizations WHERE id = ?1",
            rusqlite::params![crate::scope::current(conn)?],
            |row| row.get(0),
        )
        .ok();
    if let Some(name) = scoped {
        return Ok(name);
    }
    Ok(
        conn.query_row("SELECT name FROM organizations LIMIT 1", [], |row| {
            row.get(0)
        })?,
    )
}

fn demo_date(conn: &Connection) -> Result<String> {
    Ok(now(conn)?.format("%Y-%m-%d").to_string())
}

fn range(request: &ReportRequest, conn: &Connection) -> Result<(String, String)> {
    let end = request.date_end.clone().unwrap_or(demo_date(conn)?);
    let start = request
        .date_start
        .clone()
        .unwrap_or_else(|| format!("{}-01-01", &end[..4.min(end.len())]));
    for value in [&start, &end] {
        if chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_err() {
            return Err(CoreError::Validation(
                "Report dates must use YYYY-MM-DD.".into(),
            ));
        }
    }
    if start > end {
        return Err(CoreError::Validation(
            "The report start date must be before its end date.".into(),
        ));
    }
    Ok((start, end))
}

fn minutes(value: i64) -> String {
    format!("{}h {:02}m", value / 60, value % 60)
}

const DEFAULT_FIELDS: [&str; 6] = [
    "volunteer",
    "program",
    "date",
    "hours",
    "status",
    "verification",
];

const FIELD_LABELS: [(&str, &str); 8] = [
    ("volunteer", "Volunteer"),
    ("program", "Program"),
    ("date", "Service date"),
    ("hours", "Approved minutes"),
    ("status", "Status"),
    ("verification", "Verification"),
    ("cause", "Cause"),
    ("role", "Role"),
];

fn normalize_fields(request: &ReportRequest) -> Vec<String> {
    let mut fields: Vec<String> = if request.fields.is_empty() {
        DEFAULT_FIELDS
            .iter()
            .map(|field| field.to_string())
            .collect()
    } else {
        request
            .fields
            .iter()
            .filter(|field| FIELD_LABELS.iter().any(|(id, _)| id == field))
            .cloned()
            .collect()
    };
    if fields.is_empty() {
        fields = DEFAULT_FIELDS
            .iter()
            .map(|field| field.to_string())
            .collect();
    }
    fields
}

fn field_header(field: &str) -> String {
    FIELD_LABELS
        .iter()
        .find(|(id, _)| *id == field)
        .map(|(_, label)| (*label).to_string())
        .unwrap_or_else(|| field.to_string())
}

type ReportTable = (Vec<String>, Vec<Vec<String>>, Vec<ReportSummaryItem>);

fn participation(
    conn: &Connection,
    request: &ReportRequest,
    start: &str,
    end: &str,
) -> Result<ReportTable> {
    let fields = normalize_fields(request);
    let cause = request.cause.clone().unwrap_or_default();
    let mut statement = conn.prepare(
        "SELECT v.name, o.title, h.date, h.status,
                COALESCE(h.approved_minutes, h.minutes), h.verification_id, o.cause,
                COALESCE(reg.role, '')
         FROM hour_entries h
         JOIN volunteers v ON v.id = h.volunteer_id
         JOIN opportunities o ON o.id = h.opportunity_id
         LEFT JOIN registrations reg
           ON reg.shift_id = h.source_shift_id AND reg.volunteer_id = h.volunteer_id
         WHERE h.date >= ?1 AND h.date <= ?2 AND (?3 = '' OR o.cause = ?3)
           AND (?4 IS NULL OR o.organization_id = ?4)
         ORDER BY h.date DESC, v.name",
    )?;
    let mut rows = statement.query(params![start, end, cause, crate::scope::current(conn)?])?;
    let mut output = Vec::new();
    let mut total_minutes = 0_i64;
    let mut verified_minutes = 0_i64;
    let mut volunteers = std::collections::BTreeSet::new();
    while let Some(row) = rows.next()? {
        let volunteer: String = row.get(0)?;
        let program: String = row.get(1)?;
        let date: String = row.get(2)?;
        let status: String = row.get(3)?;
        let minutes_value: i64 = row.get(4)?;
        let verification: Option<String> = row.get(5)?;
        let cause_value: String = row.get(6)?;
        let role: String = row.get(7)?;
        total_minutes += minutes_value;
        if status == "verified" {
            verified_minutes += minutes_value;
            volunteers.insert(volunteer.clone());
        }
        let mut values = Vec::with_capacity(fields.len());
        for field in &fields {
            values.push(match field.as_str() {
                "volunteer" => volunteer.clone(),
                "program" => program.clone(),
                "date" => date.clone(),
                "hours" => minutes_value.to_string(),
                "status" => status.clone(),
                "verification" => verification.clone().unwrap_or_default(),
                "cause" => cause_value.clone(),
                "role" => role.clone(),
                _ => String::new(),
            });
        }
        output.push(values);
    }
    if request.group_by == "cause" {
        let mut indexed: Vec<(String, Vec<String>)> = output
            .iter()
            .map(|row| {
                let index = fields.iter().position(|field| field == "cause");
                let key = index
                    .and_then(|index| row.get(index))
                    .cloned()
                    .unwrap_or_default();
                (key, row.clone())
            })
            .collect();
        indexed.sort_by(|a, b| a.0.cmp(&b.0));
        output = indexed.into_iter().map(|(_, row)| row).collect();
    } else if request.group_by == "program" {
        let mut indexed: Vec<(String, Vec<String>)> = output
            .iter()
            .map(|row| {
                let index = fields.iter().position(|field| field == "program");
                let key = index
                    .and_then(|index| row.get(index))
                    .cloned()
                    .unwrap_or_default();
                (key, row.clone())
            })
            .collect();
        indexed.sort_by(|a, b| a.0.cmp(&b.0));
        output = indexed.into_iter().map(|(_, row)| row).collect();
    }
    let summary = vec![
        ReportSummaryItem {
            label: "Records".into(),
            value: output.len().to_string(),
        },
        ReportSummaryItem {
            label: "Approved or recorded".into(),
            value: minutes(total_minutes),
        },
        ReportSummaryItem {
            label: "Verified".into(),
            value: minutes(verified_minutes),
        },
        ReportSummaryItem {
            label: "Volunteers".into(),
            value: volunteers.len().to_string(),
        },
    ];
    Ok((
        fields.iter().map(|field| field_header(field)).collect(),
        output,
        summary,
    ))
}

fn coverage(conn: &Connection, request: &ReportRequest) -> Result<ReportTable> {
    let now = now(conn)?.to_rfc3339();
    let cause = request.cause.clone().unwrap_or_default();
    let mut statement = conn.prepare(
        "SELECT substr(s.starts_at, 1, 10), o.title, r.name, r.required, r.filled,
                MAX(r.required - r.filled, 0), s.status
         FROM shift_roles r
         JOIN shifts s ON s.id = r.shift_id
         JOIN opportunities o ON o.id = s.opportunity_id
         WHERE s.starts_at >= ?1 AND (?2 = '' OR o.cause = ?2)
           AND (?3 IS NULL OR o.organization_id = ?3)
         ORDER BY s.starts_at, o.title, r.name",
    )?;
    let mut rows = statement.query(params![now, cause, crate::scope::current(conn)?])?;
    let mut output = Vec::new();
    let mut required_total = 0_i64;
    let mut filled_total = 0_i64;
    while let Some(row) = rows.next()? {
        let required: i64 = row.get(3)?;
        let filled: i64 = row.get(4)?;
        required_total += required;
        filled_total += filled;
        let gap: i64 = row.get(5)?;
        let status: String = row.get(6)?;
        output.push(vec![
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            required.to_string(),
            filled.to_string(),
            gap.to_string(),
            status,
        ]);
    }
    let percent = if required_total == 0 {
        100
    } else {
        (filled_total as f64 / required_total as f64 * 100.0).round() as i64
    };
    Ok((
        vec![
            "Date".into(),
            "Program".into(),
            "Role".into(),
            "Required".into(),
            "Filled".into(),
            "Gap".into(),
            "Shift status".into(),
        ],
        output,
        vec![
            ReportSummaryItem {
                label: "Required role slots".into(),
                value: required_total.to_string(),
            },
            ReportSummaryItem {
                label: "Filled slots".into(),
                value: filled_total.to_string(),
            },
            ReportSummaryItem {
                label: "Role coverage".into(),
                value: format!("{percent}%"),
            },
        ],
    ))
}

fn attendance(
    conn: &Connection,
    request: &ReportRequest,
    start: &str,
    end: &str,
) -> Result<ReportTable> {
    let cause = request.cause.clone().unwrap_or_default();
    let mut statement = conn.prepare(
        "SELECT substr(s.starts_at, 1, 10), o.title, v.name, a.role, a.status,
                COALESCE(a.checked_in_at, ''), COALESCE(a.checked_out_at, '')
         FROM attendance_events a
         JOIN shifts s ON s.id = a.shift_id
         JOIN opportunities o ON o.id = s.opportunity_id
         JOIN volunteers v ON v.id = a.volunteer_id
         WHERE substr(s.starts_at, 1, 10) >= ?1 AND substr(s.starts_at, 1, 10) <= ?2
           AND (?3 = '' OR o.cause = ?3)
           AND (?4 IS NULL OR o.organization_id = ?4)
         ORDER BY s.starts_at DESC, v.name",
    )?;
    let mut rows = statement.query(params![start, end, cause, crate::scope::current(conn)?])?;
    let mut output = Vec::new();
    let mut checked_in = 0_i64;
    let mut completed = 0_i64;
    let mut no_show = 0_i64;
    while let Some(row) = rows.next()? {
        let status: String = row.get(4)?;
        match status.as_str() {
            "checked_in" => checked_in += 1,
            "completed" => completed += 1,
            "no_show" => no_show += 1,
            _ => {}
        }
        output.push(vec![
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            status,
            row.get::<_, String>(5)?,
            row.get::<_, String>(6)?,
        ]);
    }
    Ok((
        vec![
            "Date".into(),
            "Program".into(),
            "Volunteer".into(),
            "Role".into(),
            "Status".into(),
            "Checked in".into(),
            "Checked out".into(),
        ],
        output,
        vec![
            ReportSummaryItem {
                label: "Arrivals".into(),
                value: checked_in.to_string(),
            },
            ReportSummaryItem {
                label: "Completed".into(),
                value: completed.to_string(),
            },
            ReportSummaryItem {
                label: "No-shows".into(),
                value: no_show.to_string(),
            },
        ],
    ))
}

fn retention_rows(conn: &Connection) -> Result<ReportTable> {
    let cohorts: Vec<RetentionCohort> = retention_cohorts(conn)?;
    let eligible: i64 = cohorts.iter().map(|cohort| cohort.eligible).sum();
    let returned: i64 = cohorts.iter().map(|cohort| cohort.returned).sum();
    let rate = if eligible == 0 {
        0
    } else {
        (returned as f64 / eligible as f64 * 100.0).round() as i64
    };
    Ok((
        vec![
            "Cohort".into(),
            "Eligible".into(),
            "Returned in 30 days".into(),
            "Rate".into(),
        ],
        cohorts
            .into_iter()
            .map(|cohort| {
                vec![
                    cohort.label,
                    cohort.eligible.to_string(),
                    cohort.returned.to_string(),
                    format!("{}%", cohort.rate),
                ]
            })
            .collect(),
        vec![
            ReportSummaryItem {
                label: "Cohort eligible".into(),
                value: eligible.to_string(),
            },
            ReportSummaryItem {
                label: "Returned".into(),
                value: returned.to_string(),
            },
            ReportSummaryItem {
                label: "Average 30-day return".into(),
                value: format!("{rate}%"),
            },
        ],
    ))
}

fn skills(conn: &Connection) -> Result<ReportTable> {
    let mut statement = conn.prepare(
        "SELECT v.name, vs.skill,
                COALESCE(ct.name, '—'), COALESCE(vc.valid_through, '—'),
                CASE
                  WHEN vc.id IS NULL THEN 'no credential'
                  WHEN vc.valid_through < date('now') THEN 'expired'
                  WHEN vc.valid_through <= date('now', '+45 days') THEN 'expiring'
                  ELSE 'current'
                END
         FROM volunteer_skills vs
         JOIN volunteers v ON v.id = vs.volunteer_id
         LEFT JOIN volunteer_credentials vc ON vc.volunteer_id = v.id
         LEFT JOIN credential_types ct ON ct.id = vc.credential_type_id
         WHERE (?1 IS NULL OR v.organization_id = ?1)
         ORDER BY v.name, vs.skill",
    )?;
    let mut rows = statement.query(params![crate::scope::current(conn)?])?;
    let mut output = Vec::new();
    let mut expiring = 0_i64;
    while let Some(row) = rows.next()? {
        let status: String = row.get(4)?;
        if status == "expiring" || status == "expired" {
            expiring += 1;
        }
        output.push(vec![
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            status,
        ]);
    }
    Ok((
        vec![
            "Volunteer".into(),
            "Skill".into(),
            "Credential".into(),
            "Valid through".into(),
            "Status".into(),
        ],
        output.clone(),
        vec![
            ReportSummaryItem {
                label: "Skill rows".into(),
                value: output.len().to_string(),
            },
            ReportSummaryItem {
                label: "Expiring or expired".into(),
                value: expiring.to_string(),
            },
        ],
    ))
}

fn impact(conn: &Connection) -> Result<ReportTable> {
    let mut statement = conn.prepare(
        "SELECT o.title, d.name, d.unit, r.value, substr(r.recorded_at, 1, 10)
         FROM impact_results r
         JOIN impact_metric_definitions d ON d.id = r.definition_id
         JOIN opportunities o ON o.id = d.opportunity_id
         WHERE (?1 IS NULL OR o.organization_id = ?1)
         ORDER BY o.title, d.name, r.recorded_at",
    )?;
    let mut rows = statement.query(params![crate::scope::current(conn)?])?;
    let mut output = Vec::new();
    while let Some(row) = rows.next()? {
        let value: f64 = row.get(3)?;
        output.push(vec![
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            if value.fract() == 0.0 {
                (value as i64).to_string()
            } else {
                format!("{value:.1}")
            },
            row.get::<_, String>(4)?,
        ]);
    }
    Ok((
        vec![
            "Program".into(),
            "Metric".into(),
            "Unit".into(),
            "Value".into(),
            "Recorded".into(),
        ],
        output.clone(),
        vec![ReportSummaryItem {
            label: "Outcome records".into(),
            value: output.len().to_string(),
        }],
    ))
}

/// Builds one typed report. Every column is chosen from a fixed allow-list;
/// user input never becomes a SQL identifier.
pub fn generate(conn: &Connection, request: &ReportRequest) -> Result<ReportDocument> {
    let (start, end) = range(request, conn)?;
    let template = match request.template.as_str() {
        "participation" | "coverage" | "attendance" | "retention" | "skills" | "credentials"
        | "impact" | "custom" => request.template.clone(),
        other => {
            return Err(CoreError::Validation(format!(
                "Unknown report template: {other}"
            )))
        }
    };
    let (headers, rows, summary) = match template.as_str() {
        "coverage" => coverage(conn, request)?,
        "attendance" => attendance(conn, request, &start, &end)?,
        "retention" => retention_rows(conn)?,
        "skills" | "credentials" => skills(conn)?,
        "impact" => impact(conn)?,
        _ => participation(conn, request, &start, &end)?,
    };
    Ok(ReportDocument {
        title: title_for(&template).to_string(),
        organization: organization(conn)?,
        period: format!("{start} – {end}"),
        generated_at: now(conn)?.to_rfc3339(),
        template,
        headers,
        rows,
        summary,
    })
}

pub(crate) fn csv_cell(value: &str) -> String {
    // A cell that starts with one of these is read as a formula by Excel and
    // Sheets when the export is opened. Names and notes are entered by people,
    // so an export must not hand a spreadsheet a command to run.
    let formula = value
        .chars()
        .next()
        .is_some_and(|first| matches!(first, '=' | '+' | '-' | '@' | '\t' | '\r'));
    let guarded = if formula {
        format!("'{value}")
    } else {
        value.to_string()
    };
    format!("\"{}\"", guarded.replace('"', "\"\""))
}

pub fn to_csv(document: &ReportDocument) -> String {
    let mut lines = Vec::with_capacity(document.rows.len() + 1);
    lines.push(
        document
            .headers
            .iter()
            .map(|header| csv_cell(header))
            .collect::<Vec<_>>()
            .join(","),
    );
    for row in &document.rows {
        lines.push(
            row.iter()
                .map(|value| csv_cell(value))
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    format!("\u{feff}{}\r\n", lines.join("\r\n"))
}

/// The PDF writer is deliberately small and dependency-free: one Helvetica
/// face, Letter pages, and the same rows the CSV gets. The report preview is
/// the on-screen equivalent, so the file does not need a browser.
pub fn to_pdf(document: &ReportDocument) -> Vec<u8> {
    let page_width = 612.0_f64;
    let page_height = 792.0_f64;
    let margin = 36.0_f64;
    let row_height = 16.0_f64;
    let max_rows = ((page_height - margin * 2.0 - 170.0) / row_height).floor() as usize;
    let chunks: Vec<&[Vec<String>]> = if document.rows.is_empty() {
        vec![&[]]
    } else {
        document.rows.chunks(max_rows.max(1)).collect()
    };
    let column_width = (page_width - margin * 2.0) / document.headers.len().max(1) as f64;
    let mut contents: Vec<String> = Vec::new();
    let cell_limit = (column_width / 4.4).floor().max(6.0) as usize;
    for (page_index, chunk) in chunks.iter().enumerate() {
        let mut stream = String::new();
        stream.push_str("BT\n");
        stream.push_str(&format!(
            "/F1 18 Tf\n1 0 0 1 {margin} 754 Tm\n({}) Tj\n",
            pdf_text(&document.organization)
        ));
        stream.push_str(&format!(
            "/F1 10 Tf\n1 0 0 1 {margin} 734 Tm\n({}) Tj\n",
            pdf_text(&document.title)
        ));
        stream.push_str(&format!(
            "/F1 9 Tf\n1 0 0 1 {margin} 718 Tm\n({}) Tj\n",
            pdf_text(&format!(
                "{} · generated {}",
                document.period, document.generated_at
            ))
        ));
        let mut y = 694.0;
        stream.push_str("/F1 9 Tf\n");
        for item in &document.summary {
            stream.push_str(&format!(
                "1 0 0 1 {margin} {y} Tm\n({}) Tj\n",
                pdf_text(&format!("{}: {}", item.label, item.value))
            ));
            y -= 13.0;
        }
        y -= 8.0;
        stream.push_str("/F1 8 Tf\n");
        for (index, header) in document.headers.iter().enumerate() {
            let x = margin + index as f64 * column_width;
            stream.push_str(&format!(
                "1 0 0 1 {x} {y} Tm\n({}) Tj\n",
                pdf_text(&truncate(header, cell_limit))
            ));
        }
        y -= 15.0;
        for row in chunk.iter() {
            for (index, value) in row.iter().enumerate() {
                let x = margin + index as f64 * column_width;
                stream.push_str(&format!(
                    "1 0 0 1 {x} {y} Tm\n({}) Tj\n",
                    pdf_text(&truncate(value, cell_limit))
                ));
            }
            y -= row_height;
        }
        stream.push_str("ET\n");
        stream.push_str(&format!(
            "BT /F1 8 Tf 1 0 0 1 {margin} 24 Tm (Page {} of {}) Tj ET",
            page_index + 1,
            chunks.len()
        ));
        contents.push(stream);
    }

    let mut objects: Vec<String> = Vec::new();
    let page_count = contents.len();
    objects.push("<< /Type /Catalog /Pages 2 0 R >>".into());
    let kids = (0..page_count)
        .map(|index| format!("{} 0 R", 5 + index * 2))
        .collect::<Vec<_>>()
        .join(" ");
    objects.push(format!(
        "<< /Type /Pages /Kids [{kids}] /Count {page_count} >>"
    ));
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".into());
    for (index, content) in contents.iter().enumerate() {
        let content_id = 4 + index * 2;
        let page_id = content_id + 1;
        objects.push(format!(
            "<< /Length {} >>\nstream\n{}\nendstream",
            content.len(),
            content
        ));
        objects.push(format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_width} {page_height}] \
             /Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>"
        ));
        let _ = page_id;
    }

    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets = Vec::with_capacity(objects.len());
    for (index, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.push_str(&format!("{} 0 obj\n{}\nendobj\n", index + 1, object));
    }
    let xref_at = pdf.len();
    pdf.push_str(&format!("xref\n0 {}\n", objects.len() + 1));
    pdf.push_str("0000000000 65535 f \n");
    for offset in offsets {
        pdf.push_str(&format!("{offset:010} 00000 n \n"));
    }
    pdf.push_str(&format!(
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n",
        objects.len() + 1
    ));
    pdf.into_bytes()
}

fn truncate(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    let mut output: String = value.chars().take(limit.saturating_sub(1)).collect();
    output.push('…');
    output
}

fn pdf_text(value: &str) -> String {
    let folded: String = value
        .chars()
        .map(|character| match character {
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' => 'a',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'ö' | 'õ' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ñ' => 'n',
            'ç' => 'c',
            'É' | 'È' | 'Ê' | 'Ë' => 'E',
            'Á' | 'À' | 'Â' | 'Ä' | 'Ã' | 'Å' => 'A',
            'Í' | 'Ì' | 'Î' | 'Ï' => 'I',
            'Ó' | 'Ò' | 'Ô' | 'Ö' | 'Õ' => 'O',
            'Ú' | 'Ù' | 'Û' | 'Ü' => 'U',
            'Ñ' => 'N',
            'Ç' => 'C',
            '—' | '–' | '…' => '-',
            '“' | '”' => '"',
            '‘' | '’' => '\'',
            other if other.is_ascii() => other,
            _ => '?',
        })
        .collect();
    folded
        .replace('\\', "\\\\")
        .replace('(', "\\(")
        .replace(')', "\\)")
}

pub fn export(document: &ReportDocument, format: ExportFormat, path: &Path) -> Result<()> {
    match format {
        ExportFormat::Csv => fs::write(path, to_csv(document))?,
        ExportFormat::Pdf => fs::write(path, to_pdf(document))?,
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document() -> ReportDocument {
        ReportDocument {
            template: "custom".into(),
            title: "Custom report".into(),
            organization: "Rivergate Kitchen".into(),
            period: "2026-01-01 – 2026-10-13".into(),
            generated_at: "2026-10-13T07:45:00-04:00".into(),
            headers: vec!["Volunteer".into(), "Note".into()],
            rows: vec![vec!["Maya Chen".into(), "Comma, quote \"yes\"".into()]],
            summary: vec![ReportSummaryItem {
                label: "Records".into(),
                value: "1".into(),
            }],
        }
    }

    #[test]
    fn csv_escapes_commas_and_quotes() {
        let csv = to_csv(&document());
        assert!(csv.contains("\"Comma, quote \"\"yes\"\"\""));
        assert!(csv.starts_with('\u{feff}'));
    }

    #[test]
    fn csv_neutralises_cells_a_spreadsheet_would_run() {
        let mut report = document();
        report.rows = vec![
            vec![
                "=HYPERLINK(\"http://example.org\",\"open\")".into(),
                "Normal".into(),
            ],
            vec!["@SUM(1+1)".into(), "-12".into()],
        ];
        let csv = to_csv(&report);

        assert!(csv.contains("\"'=HYPERLINK"));
        assert!(csv.contains("\"'@SUM"));
        assert!(csv.contains("\"'-12\""), "a leading dash is guarded too");
        assert!(!csv.contains("\"=HYPERLINK"), "no cell starts as a formula");
        assert!(csv.contains("\"Normal\""));
    }

    #[test]
    fn pdf_has_a_catalog_pages_and_font() {
        let bytes = to_pdf(&document());
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.starts_with("%PDF-1.4"));
        assert!(text.contains("/Type /Catalog"));
        assert!(text.contains("/Type /Pages"));
        assert!(text.contains("/BaseFont /Helvetica"));
        assert!(text.contains("startxref"));
        assert!(bytes.len() > 900);
    }

    #[test]
    fn export_format_is_validated() {
        assert!(ExportFormat::parse("csv").is_ok());
        assert!(ExportFormat::parse("PDF").is_ok());
        assert!(ExportFormat::parse("xlsx").is_err());
    }
}
