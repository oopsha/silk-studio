use silk_archive::{create_archive_entries, extract_archive, extract_entries, test_archive, ArchiveFormat, CreateInput};
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

#[test]
fn extracts_only_selected_entries_without_their_parent_folders() {
    let workspace = Workspace::new();
    let cancelled = Arc::new(AtomicBool::new(false));
    let mut inputs = Vec::new();
    for (path, text) in [
        ("top/mid/leaf/a.txt", "a"),
        ("top/mid/b.txt", "b"),
        ("top/한글 폴더/c.txt", "c"),
        ("top/d.txt", "d"),
        ("e.txt", "e"),
    ] {
        let source = workspace.0.join(path.replace('/', "_"));
        fs::write(&source, text).unwrap();
        inputs.push(CreateInput { source_path: Some(source), archive_path: path.into() });
    }
    for (format, name) in [
        (ArchiveFormat::Zip, "n.zip"),
        (ArchiveFormat::SevenZip, "n.7z"),
        (ArchiveFormat::Tgz, "n.tgz"),
    ] {
        let archive = workspace.0.join(name);
        create_archive_entries(format, &inputs, &archive, 6, None, None, &cancelled, |_| {}, None).unwrap();

        let folder = workspace.0.join(format!("folder-{name}"));
        extract_entries(&archive, &folder, None, false, &["top/mid".into()], &cancelled, |_| {}).unwrap();
        assert_eq!(fs::read_to_string(folder.join("mid/leaf/a.txt")).unwrap(), "a", "{name}");
        assert_eq!(fs::read_to_string(folder.join("mid/b.txt")).unwrap(), "b", "{name}");
        assert!(!folder.join("d.txt").exists() && !folder.join("top").exists() && !folder.join("e.txt").exists(), "{name}");

        let file = workspace.0.join(format!("file-{name}"));
        extract_entries(&archive, &file, None, false, &["top/d.txt".into(), "top/한글 폴더".into()], &cancelled, |_| {}).unwrap();
        assert_eq!(fs::read_to_string(file.join("d.txt")).unwrap(), "d", "{name}");
        assert_eq!(fs::read_to_string(file.join("한글 폴더/c.txt")).unwrap(), "c", "{name}");
        assert!(!file.join("mid").exists(), "{name}");

        let none = workspace.0.join(format!("none-{name}"));
        let error = extract_entries(&archive, &none, None, false, &["missing".into()], &cancelled, |_| {}).unwrap_err();
        assert!(error.contains("찾지 못"), "{name}: {error}");
    }
}

#[test]
fn tests_archives_without_writing_and_reports_damage() {
    let workspace = Workspace::new();
    let inputs = sample(&workspace);
    let cancelled = Arc::new(AtomicBool::new(false));
    for (format, name) in [(ArchiveFormat::Zip, "t.zip"), (ArchiveFormat::SevenZip, "t.7z"), (ArchiveFormat::Tgz, "t.tgz")] {
        let archive = workspace.0.join(name);
        create_archive_entries(format, &inputs, &archive, 6, None, None, &cancelled, |_| {}, None).unwrap();
        let result = test_archive(&archive, None, &cancelled, |_| {}).unwrap();
        assert!(result.tested >= 1, "{name}: {result:?}");
        // Flip bytes inside the compressed data of a damaged copy.
        let mut bytes = fs::read(&archive).unwrap();
        let middle = bytes.len() / 2;
        for byte in &mut bytes[middle..middle + 8] {
            *byte ^= 0xFF;
        }
        let damaged = workspace.0.join(format!("damaged-{name}"));
        fs::write(&damaged, bytes).unwrap();
        let error = test_archive(&damaged, None, &cancelled, |_| {}).unwrap_err();
        assert!(error.contains("문제") || error.contains("손상") || error.contains("지원하지"), "{name}: {error}");
    }
    let locked = workspace.0.join("locked.7z");
    create_archive_entries(ArchiveFormat::SevenZip, &inputs, &locked, 6, Some("pw"), None, &cancelled, |_| {}, None).unwrap();
    assert!(test_archive(&locked, None, &cancelled, |_| {}).unwrap_err().contains("암호"));
    assert!(test_archive(&locked, Some("pw"), &cancelled, |_| {}).is_ok());
    let only_test = workspace.0.join("only-test");
    assert!(!only_test.exists());
}
