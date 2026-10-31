use civicflow_core::reports::{export, generate, to_csv, ExportFormat, ReportRequest};
use civicflow_core::Database;

fn seeded() -> Database {
    let mut database = Database::in_memory().expect("in-memory database");
    assert!(database.seed_demo_if_empty().expect("seed"));
    database
}

fn request(template: &str) -> ReportRequest {
    ReportRequest {
        template: template.into(),
        fields: vec![],
        date_start: Some("2026-01-01".into()),
        date_end: Some("2026-10-13".into()),
        cause: None,
        group_by: "none".into(),
    }
}

#[test]
fn participation_report_uses_approved_rows_and_totals() {
    let database = seeded();
    let report = generate(database.connection(), &request("participation")).expect("report");
    assert_eq!(report.title, "Volunteer participation");
    assert_eq!(report.organization, "Rivergate Kitchen");
    assert!(!report.rows.is_empty());
    assert_eq!(report.headers.len(), report.rows[0].len());
    assert!(report
        .summary
        .iter()
        .any(|item| item.label == "Verified" && item.value != "0h 00m"));
    let csv = to_csv(&report);
    assert!(csv.starts_with('\u{feff}'));
    assert!(csv.lines().count() >= report.rows.len());
}

#[test]
fn custom_fields_are_limited_to_the_allow_list() {
    let database = seeded();
    let mut custom = request("custom");
    custom.fields = vec!["volunteer".into(), "not_a_column".into(), "program".into()];
    let report = generate(database.connection(), &custom).expect("report");
    assert_eq!(report.headers, vec!["Volunteer", "Program"]);
    assert!(report.rows.iter().all(|row| row.len() == 2));
}

#[test]
fn coverage_and_retention_reports_are_computed_from_records() {
    let database = seeded();
    let coverage = generate(database.connection(), &request("coverage")).expect("coverage");
    assert!(!coverage.rows.is_empty());
    assert!(coverage.rows.iter().any(|row| row[5] != "0"));
    let retention = generate(database.connection(), &request("retention")).expect("retention");
    assert_eq!(retention.rows.len(), 6);
    let eligible: i64 = retention
        .rows
        .iter()
        .map(|row| row[1].parse::<i64>().unwrap())
        .sum();
    assert!(eligible > 0);
}

#[test]
fn empty_reports_still_have_headers_and_export_files() {
    let database = seeded();
    let mut empty = request("custom");
    empty.date_start = Some("2030-01-01".into());
    empty.date_end = Some("2030-01-31".into());
    let report = generate(database.connection(), &empty).expect("empty report");
    assert!(report.rows.is_empty());
    assert!(!report.headers.is_empty());

    let directory = tempfile::tempdir().expect("temp dir");
    let csv_path = directory.path().join("report.csv");
    export(&report, ExportFormat::Csv, &csv_path).expect("csv export");
    let csv = std::fs::read_to_string(&csv_path).expect("csv read");
    assert!(csv.contains("Volunteer"));
    let pdf_path = directory.path().join("report.pdf");
    export(&report, ExportFormat::Pdf, &pdf_path).expect("pdf export");
    let bytes = std::fs::read(&pdf_path).expect("pdf read");
    assert!(bytes.starts_with(b"%PDF-1.4"));
    assert!(bytes.len() > 900);
}

#[test]
fn unknown_templates_and_bad_dates_are_refused() {
    let database = seeded();
    let mut bad = request("nope");
    assert!(generate(database.connection(), &bad).is_err());
    bad = request("custom");
    bad.date_start = Some("yesterday".into());
    assert!(generate(database.connection(), &bad).is_err());
    bad.date_start = Some("2026-10-14".into());
    bad.date_end = Some("2026-10-13".into());
    assert!(generate(database.connection(), &bad).is_err());
}
