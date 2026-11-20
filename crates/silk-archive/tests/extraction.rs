use silk_archive::{create_archive_entries, extract_archive, ArchiveFormat, CreateInput};
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc,
    },
};

struct Workspace(PathBuf);

impl Workspace {
    fn new() -> Self {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let path = std::env::temp_dir().join(format!(
            "silk-extract-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn sample(workspace: &Workspace) -> Vec<CreateInput> {
    let a = workspace.0.join("a.txt");
    let b = workspace.0.join("b.bin");
    fs::write(&a, "한글 내용 hello hello hello").unwrap();
    fs::write(&b, (0..70_000u32).map(|v| (v * 31 % 251) as u8).collect::<Vec<_>>()).unwrap();
    vec![
        CreateInput { source_path: None, archive_path: "empty".into() },
        CreateInput { source_path: Some(a), archive_path: "dir/한글.txt".into() },
        CreateInput { source_path: Some(b), archive_path: "b.bin".into() },
    ]
}

fn check(out: &PathBuf) {
    assert_eq!(fs::read_to_string(out.join("dir/한글.txt")).unwrap(), "한글 내용 hello hello hello");
    assert_eq!(fs::read(out.join("b.bin")).unwrap().len(), 70_000);
    assert!(out.join("empty").is_dir());
    assert!(fs::read_dir(out).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().starts_with(".silk-zip")));
}

#[test]
fn round_trips_every_created_format() {
    let workspace = Workspace::new();
    let inputs = sample(&workspace);
    let cancelled = Arc::new(AtomicBool::new(false));
    for (format, name) in [
        (ArchiveFormat::Zip, "x.zip"),
        (ArchiveFormat::Tar, "x.tar"),
        (ArchiveFormat::Tgz, "x.tgz"),
        (ArchiveFormat::SevenZip, "x.7z"),
    ] {
        let archive = workspace.0.join(name);
        create_archive_entries(format, &inputs, &archive, 6, None, None, &cancelled, |_| {}, None).unwrap();
        let out = workspace.0.join(format!("out-{name}"));
        let result = extract_archive(&archive, &out, None, false, &cancelled, |_| {}).unwrap();
        assert!(result.extracted >= 2, "{name}: {result:?}");
        check(&out);
    }
}

#[test]
fn extracts_single_file_compressors_and_split_volumes() {
    let workspace = Workspace::new();
    let inputs = sample(&workspace);
    let cancelled = Arc::new(AtomicBool::new(false));
    let single = &inputs[2..3];
    for (format, name) in [(ArchiveFormat::Gz, "b.bin.gz"), (ArchiveFormat::Xz, "b.bin.xz")] {
        let archive = workspace.0.join(name);
        create_archive_entries(format, single, &archive, 6, None, None, &cancelled, |_| {}, None).unwrap();
        let out = workspace.0.join(format!("out-{name}"));
        extract_archive(&archive, &out, None, false, &cancelled, |_| {}).unwrap();
        assert_eq!(fs::read(out.join("b.bin")).unwrap().len(), 70_000, "{name}");
    }
    let archive = workspace.0.join("parts.7z");
    create_archive_entries(ArchiveFormat::SevenZip, &inputs, &archive, 1, Some("pw"), Some(64 * 1024),
        &cancelled, |_| {}, None).unwrap();
    let first = workspace.0.join("parts.7z.001");
    assert!(first.exists());
    let out = workspace.0.join("out-split");
    let missing = extract_archive(&first, &out, None, false, &cancelled, |_| {}).unwrap_err();
    assert!(missing.contains("암호"), "{missing}");
    let wrong = extract_archive(&first, &out, Some("nope"), false, &cancelled, |_| {}).unwrap_err();
    assert!(wrong.contains("암호") || wrong.contains("손상"), "{wrong}");
    extract_archive(&first, &out, Some("pw"), false, &cancelled, |_| {}).unwrap();
    check(&out);
}

#[test]
fn keeps_existing_files_unless_overwriting() {
    let workspace = Workspace::new();
    let inputs = sample(&workspace);
    let cancelled = Arc::new(AtomicBool::new(false));
    let archive = workspace.0.join("x.zip");
    create_archive_entries(ArchiveFormat::Zip, &inputs, &archive, 6, None, None, &cancelled, |_| {}, None).unwrap();
    let out = workspace.0.join("out");
    fs::create_dir_all(out.join("dir")).unwrap();
    fs::write(out.join("dir/한글.txt"), "mine").unwrap();
    let result = extract_archive(&archive, &out, None, false, &cancelled, |_| {}).unwrap();
    assert_eq!(fs::read_to_string(out.join("dir/한글.txt")).unwrap(), "mine");
    assert!(result.skipped >= 1, "{result:?}");
    extract_archive(&archive, &out, None, true, &cancelled, |_| {}).unwrap();
    assert_eq!(fs::read_to_string(out.join("dir/한글.txt")).unwrap(), "한글 내용 hello hello hello");
}
