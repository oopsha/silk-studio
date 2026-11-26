use silk_archive::{create_archive_entries, extract_archive, extract_entries, repair_archive, test_archive, update_archive, EntryChange, ArchiveFormat, CreateInput};
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

#[test]
fn updates_archives_in_one_pass() {
    let workspace = Workspace::new();
    let inputs = sample(&workspace);
    let cancelled = Arc::new(AtomicBool::new(false));
    let extra = workspace.0.join("extra.txt");
    fs::write(&extra, "added later").unwrap();
    let rename = |from: &str, to: &str| EntryChange::Rename { from: from.into(), to: to.into() };
    let delete = |path: &str| EntryChange::Delete { path: path.into() };
    let added = |source: Option<&std::path::Path>, path: &str| CreateInput { source_path: source.map(|p| p.to_path_buf()), archive_path: path.into() };

    for (format, name) in [(ArchiveFormat::Zip, "u.zip"), (ArchiveFormat::SevenZip, "u.7z"), (ArchiveFormat::Tar, "u.tar")] {
        let archive = workspace.0.join(name);
        create_archive_entries(format, &inputs, &archive, 6, None, None, &cancelled, |_| {}, None).unwrap();

        // Rename a folder, then a file inside it (new names), delete a file, add a file and an empty folder.
        let result = update_archive(
            &archive,
            &[rename("dir", "folder2"), rename("folder2/한글.txt", "folder2/새 이름.txt"), delete("b.bin")],
            &[added(Some(&extra), "folder2/added.txt"), added(None, "newdir")],
            None,
            &cancelled,
            |_| {},
        )
        .unwrap();
        assert_eq!((result.removed, result.added), (1, 2), "{name}: {result:?}");
        assert!(result.renamed >= 1, "{name}: {result:?}");
        let out = workspace.0.join(format!("out-{name}"));
        extract_archive(&archive, &out, None, false, &cancelled, |_| {}).unwrap();
        assert_eq!(fs::read_to_string(out.join("folder2/새 이름.txt")).unwrap(), "한글 내용 hello hello hello", "{name}");
        assert_eq!(fs::read_to_string(out.join("folder2/added.txt")).unwrap(), "added later", "{name}");
        assert!(out.join("newdir").is_dir() && out.join("empty").is_dir(), "{name}");
        assert!(!out.join("b.bin").exists() && !out.join("dir").exists(), "{name}");
        assert!(test_archive(&archive, None, &cancelled, |_| {}).is_ok(), "{name}");

        // Two entries ending up with one path, and nothing to do.
        let duplicate = update_archive(&archive, &[], &[added(Some(&extra), "folder2/added.txt")], None, &cancelled, |_| {}).unwrap_err();
        assert!(duplicate.contains("이미 있습니다"), "{name}: {duplicate}");
        let nothing = update_archive(&archive, &[delete("missing")], &[], None, &cancelled, |_| {}).unwrap_err();
        assert!(nothing.contains("찾지 못"), "{name}: {nothing}");
        // No leftovers next to the archive.
        assert!(fs::read_dir(&workspace.0).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().contains("silk-")), "{name}");
    }
    let tgz = workspace.0.join("u.tgz");
    create_archive_entries(ArchiveFormat::Tgz, &inputs, &tgz, 6, None, None, &cancelled, |_| {}, None).unwrap();
    let error = update_archive(&tgz, &[delete("b.bin")], &[], None, &cancelled, |_| {}).unwrap_err();
    assert!(error.contains("지원하지 않습니다"), "{error}");

    // Encrypted 7z: names are hidden, so the password is needed to change anything.
    let locked = workspace.0.join("locked.7z");
    create_archive_entries(ArchiveFormat::SevenZip, &inputs, &locked, 6, Some("pw"), None, &cancelled, |_| {}, None).unwrap();
    assert!(update_archive(&locked, &[rename("b.bin", "c.bin")], &[], None, &cancelled, |_| {}).unwrap_err().contains("암호"));
    update_archive(&locked, &[rename("b.bin", "c.bin")], &[added(Some(&extra), "added.txt")], Some("pw"), &cancelled, |_| {}).unwrap();
    let out = workspace.0.join("out-locked");
    extract_archive(&locked, &out, Some("pw"), false, &cancelled, |_| {}).unwrap();
    assert_eq!(fs::read(out.join("c.bin")).unwrap().len(), 70_000);
    assert_eq!(fs::read_to_string(out.join("added.txt")).unwrap(), "added later");
    assert!(extract_archive(&locked, &workspace.0.join("nope"), None, false, &cancelled, |_| {}).unwrap_err().contains("암호"));
}

#[test]
fn lists_compressed_size_time_crc_and_method() {
    let workspace = Workspace::new();
    let inputs = sample(&workspace);
    let cancelled = Arc::new(AtomicBool::new(false));
    for (format, name) in [(ArchiveFormat::Zip, "d.zip"), (ArchiveFormat::SevenZip, "d.7z"), (ArchiveFormat::Tar, "d.tar")] {
        let archive = workspace.0.join(name);
        create_archive_entries(format, &inputs, &archive, 6, None, None, &cancelled, |_| {}, None).unwrap();
        let listing = silk_archive::list_archive(&archive).unwrap();
        let file = listing.entries.iter().find(|entry| entry.path.ends_with("b.bin")).unwrap();
        assert_eq!(file.size, Some(70_000), "{name}");
        assert!(file.modified.is_some_and(|time| time > 1_600_000_000), "{name} modified");
        if name != "d.tar" {
            assert!(file.attributes.is_some(), "{name} attributes");
            assert!(file.packed_size.is_some_and(|packed| packed > 0), "{name} packed");
            assert!(file.crc.is_some(), "{name} crc");
            assert!(file.method.is_some(), "{name} method");
        }
    }
    // Encrypted zip: the method names the encryption.
    let encrypted = workspace.0.join("e.zip");
    create_archive_entries(ArchiveFormat::Zip, &inputs, &encrypted, 6, Some("secret"), None, &cancelled, |_| {}, None).unwrap();
    let listing = silk_archive::list_archive(&encrypted).unwrap();
    let file = listing.entries.iter().find(|entry| entry.path.ends_with("b.bin")).unwrap();
    assert!(file.encrypted);
    assert_eq!(file.encryption.as_deref(), Some("ZipCrypto"));
}

#[test]
fn repairs_damaged_archives_into_a_new_one() {
    let workspace = Workspace::new();
    let inputs = sample(&workspace);
    let cancelled = Arc::new(AtomicBool::new(false));
    let zip = workspace.0.join("good.zip");
    create_archive_entries(ArchiveFormat::Zip, &inputs, &zip, 6, None, None, &cancelled, |_| {}, None).unwrap();
    let bytes = fs::read(&zip).unwrap();
    let names = |archive: &PathBuf| {
        let mut names: Vec<String> = silk_archive::list_archive(archive).unwrap().entries.into_iter().map(|entry| entry.path.trim_end_matches('/').to_string()).collect();
        names.sort();
        names
    };

    // The end of the file is missing (no central directory): everything is still found.
    let cut = workspace.0.join("cut.zip");
    fs::write(&cut, &bytes[..bytes.len() - 120]).unwrap();
    let fixed = workspace.0.join("cut-fixed.zip");
    let result = repair_archive(&cut, &fixed, None, &cancelled, |_| {}).unwrap();
    assert_eq!((result.recovered, result.lost), (3, 0));
    assert_eq!(names(&fixed), vec!["b.bin", "dir", "dir/한글.txt", "empty"]);

    // Damaged data inside one entry: that entry is lost, the rest is kept.
    let mut flipped = bytes.clone();
    for byte in &mut flipped[200..260] { *byte ^= 0xFF; }
    let bad = workspace.0.join("bad.zip");
    fs::write(&bad, &flipped).unwrap();
    let fixed = workspace.0.join("bad-fixed.zip");
    let result = repair_archive(&bad, &fixed, None, &cancelled, |_| {}).unwrap();
    assert_eq!(result.lost, 1);
    assert!(result.recovered >= 1);
    let out = workspace.0.join("bad-out");
    extract_archive(&fixed, &out, None, true, &cancelled, |_| {}).unwrap();

    // Other bytes in front of the archive.
    let mut front = vec![0u8; 100];
    front.extend_from_slice(&bytes);
    let pre = workspace.0.join("pre.zip");
    fs::write(&pre, &front).unwrap();
    let fixed = workspace.0.join("pre-fixed.zip");
    let result = repair_archive(&pre, &fixed, None, &cancelled, |_| {}).unwrap();
    assert_eq!(result.recovered, 3);

    // Nothing readable: no output file, the original stays.
    let junk = workspace.0.join("junk.zip");
    fs::write(&junk, vec![7u8; 5000]).unwrap();
    let fixed = workspace.0.join("junk-fixed.zip");
    assert!(repair_archive(&junk, &fixed, None, &cancelled, |_| {}).is_err());
    assert!(!fixed.exists());
    // The result never overwrites the damaged file.
    assert!(repair_archive(&cut, &cut, None, &cancelled, |_| {}).is_err());
    assert!(fs::read_dir(&workspace.0).unwrap().all(|entry| !entry.unwrap().file_name().to_string_lossy().starts_with(".silk-zip-repair")));
}
