use silk_archive::{create_archive_entries, create_zip_entries, list_archive, ArchiveFormat, CreateInput};
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
};

static NEXT: AtomicU64 = AtomicU64::new(0);

#[test]
fn fast_zip_records_crc_and_supports_cancellation() {
    let workspace = Workspace::new();
    let source = workspace.0.join("payload.txt");
    fs::write(&source, b"hello").unwrap();
    let output = workspace.0.join("fast.zip");
    let inputs = [CreateInput {
        source_path: Some(source),
        archive_path: "payload.txt".into(),
    }];
    create_zip_entries(&inputs, &output, 1, None,
        &Arc::new(AtomicBool::new(false)), |_| {}).unwrap();
    let bytes = fs::read(&output).unwrap();
    let central = bytes.windows(4).position(|bytes| bytes == b"PK\x01\x02").unwrap();
    assert_eq!(u32::from_le_bytes(bytes[central + 16..central + 20].try_into().unwrap()),
        0x3610a686);
    let cancelled_output = workspace.0.join("cancelled.zip");
    assert!(create_zip_entries(&inputs, &cancelled_output, 1, None,
        &Arc::new(AtomicBool::new(true)), |_| {}).is_err());
    assert!(!cancelled_output.exists());
}
struct Workspace(PathBuf);
impl Workspace {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "silk-draft-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
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

#[test]
fn writes_virtual_folders_and_files_at_explicit_archive_paths() {
    let workspace = Workspace::new();
    let file = workspace.0.join("original.txt");
    fs::write(&file, "hello").unwrap();
    let output = workspace.0.join("result.zip");
    let result = create_zip_entries(
        &[
            CreateInput {
                source_path: None,
                archive_path: "새 폴더".into(),
            },
            CreateInput {
                source_path: None,
                archive_path: "빈 폴더".into(),
            },
            CreateInput {
                source_path: Some(file),
                archive_path: "새 폴더/renamed.txt".into(),
            },
        ],
        &output,
        6,
        None,
        &Arc::new(AtomicBool::new(false)),
        |_| {},
    )
    .unwrap();
    assert_eq!(result.entries, 3);
    let listing = list_archive(&output).unwrap();
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.path == "새 폴더/" && entry.directory));
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.path == "빈 폴더/" && entry.directory));
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.path == "새 폴더/renamed.txt" && entry.size == Some(5)));
    assert!(!workspace.0.join("새 폴더").exists());
}

#[test]
fn rejects_unsafe_duplicate_and_file_parent_paths() {
    let workspace = Workspace::new();
    let output = workspace.0.join("result.zip");
    let cancellation = Arc::new(AtomicBool::new(false));
    for path in ["../outside", "/absolute", "C:/absolute", "a/../b", "a\\b"] {
        assert!(create_zip_entries(
            &[CreateInput {
                source_path: None,
                archive_path: path.into()
            }],
            &output,
            6,
            None,
            &cancellation,
            |_| {}
        )
        .is_err());
    }
    let file = workspace.0.join("source.txt");
    fs::write(&file, "data").unwrap();
    for second in ["FILE", "file/child"] {
        assert!(create_zip_entries(
            &[
                CreateInput {
                    source_path: Some(file.clone()),
                    archive_path: "file".into()
                },
                CreateInput {
                    source_path: None,
                    archive_path: second.into()
                },
            ],
            &output,
            6,
            None,
            &cancellation,
            |_| {}
        )
        .is_err());
    }
    assert!(!output.exists());
}

#[test]
#[ignore]
fn bench_compression_levels() {
    let dir = std::env::var_os("SILK_BENCH_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("silk-bench"));
    fs::create_dir_all(&dir).unwrap();
    let mut state = 0x2545F4914F6CDD1Du64;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    let words: Vec<String> = (0..4000).map(|_| format!("w{:x}", next() % 0xfffff)).collect();
    let mut text = Vec::with_capacity(64 << 20);
    while text.len() < 64 << 20 {
        text.extend_from_slice(words[(next() % 4000) as usize].as_bytes());
        text.push(if next() % 12 == 0 { b'\n' } else { b' ' });
    }
    let random: Vec<u8> = (0..32 << 20).map(|_| next() as u8).collect();
    fs::write(dir.join("text.bin"), &text).unwrap();
    fs::write(dir.join("random.bin"), &random).unwrap();
    for name in ["text.bin", "random.bin"] {
        for level in [1u8, 6, 9] {
            let inputs = [CreateInput {
                source_path: Some(dir.join(name)),
                archive_path: name.into(),
            }];
            let output = dir.join(format!("{name}.{level}.zip"));
            let start = std::time::Instant::now();
            create_zip_entries(&inputs, &output, level, None,
                &Arc::new(AtomicBool::new(false)), |_| {}).unwrap();
            println!("BENCH {name} level={level} time={:.2}s size={}",
                start.elapsed().as_secs_f64(), fs::metadata(&output).unwrap().len());
        }
    }
    for (format, ext) in [(ArchiveFormat::Gz, "gz"), (ArchiveFormat::Tgz, "tgz"), (ArchiveFormat::Xz, "xz"), (ArchiveFormat::SevenZip, "7z")] {
        for level in [1u8, 6, 9] {
            let names: &[&str] = if format != ArchiveFormat::Tgz && format != ArchiveFormat::SevenZip { &["text.bin"] } else { &["text.bin", "random.bin"] };
            let inputs: Vec<_> = names.iter().map(|name| CreateInput {
                source_path: Some(dir.join(name)), archive_path: (*name).into() }).collect();
            let output = dir.join(format!("out.{level}.{ext}"));
            let start = std::time::Instant::now();
            create_archive_entries(format, &inputs, &output, level, None, None,
                &Arc::new(AtomicBool::new(false)), |_| {}, None).unwrap();
            println!("BENCH {ext} level={level} time={:.2}s size={}",
                start.elapsed().as_secs_f64(), fs::metadata(&output).unwrap().len());
        }
    }
}

#[test]
fn tar_stores_files_and_folders_without_compression() {
    let workspace = Workspace::new();
    let file = workspace.0.join("a.txt");
    fs::write(&file, b"tar payload").unwrap();
    let output = workspace.0.join("out.tar");
    let inputs = [
        CreateInput { source_path: None, archive_path: "dir".into() },
        CreateInput { source_path: Some(file), archive_path: "dir/a.txt".into() },
    ];
    let cancelled = Arc::new(AtomicBool::new(false));
    let result = create_archive_entries(ArchiveFormat::Tar, &inputs, &output, 6, None, None,
        &cancelled, |_| {}, None).unwrap();
    assert_eq!(result.entries, 2);
    assert!(fs::read(&output).unwrap().windows(11).any(|bytes| bytes == b"tar payload"));
    let listing = list_archive(&output).unwrap();
    let names: Vec<_> = listing.entries.iter().map(|entry| entry.path.trim_end_matches('/').to_string()).collect();
    assert!(names.contains(&"dir".to_string()) && names.contains(&"dir/a.txt".to_string()), "{names:?}");
    assert!(create_archive_entries(ArchiveFormat::Tar, &inputs, &output, 6, Some("pw"), None,
        &cancelled, |_| {}, None).is_err());
    assert!(create_archive_entries(ArchiveFormat::Tar, &inputs, &output, 6, None, Some(1 << 20),
        &cancelled, |_| {}, None).is_err());
    let wrong = workspace.0.join("out.zip");
    assert!(create_archive_entries(ArchiveFormat::Tar, &inputs, &wrong, 6, None, None,
        &cancelled, |_| {}, None).is_err());
}

fn gzip_header_and_trailer(bytes: &[u8]) -> (Option<String>, u32, u32) {
    assert_eq!(&bytes[..3], &[0x1f, 0x8b, 8]);
    let mut offset = 10;
    let mut name = None;
    if bytes[3] & 8 != 0 {
        let end = bytes[offset..].iter().position(|byte| *byte == 0).unwrap();
        name = Some(String::from_utf8(bytes[offset..offset + end].to_vec()).unwrap());
        offset += end + 1;
    }
    assert!(offset < bytes.len() - 8);
    let tail = &bytes[bytes.len() - 8..];
    (
        name,
        u32::from_le_bytes(tail[..4].try_into().unwrap()),
        u32::from_le_bytes(tail[4..].try_into().unwrap()),
    )
}

#[test]
fn gz_compresses_one_file_and_tgz_wraps_a_tar() {
    let workspace = Workspace::new();
    let file = workspace.0.join("hello.txt");
    fs::write(&file, b"hello").unwrap();
    let cancelled = Arc::new(AtomicBool::new(false));
    let single = [CreateInput { source_path: Some(file.clone()), archive_path: "hello.txt".into() }];
    for level in [1u8, 6, 9] {
        let output = workspace.0.join(format!("hello-{level}.txt.gz"));
        create_archive_entries(ArchiveFormat::Gz, &single, &output, level, None, None,
            &cancelled, |_| {}, None).unwrap();
        let (name, crc, size) = gzip_header_and_trailer(&fs::read(&output).unwrap());
        assert_eq!(name.as_deref(), Some("hello.txt"));
        assert_eq!((crc, size), (0x3610a686, 5));
    }
    let two = [
        CreateInput { source_path: Some(file.clone()), archive_path: "a.txt".into() },
        CreateInput { source_path: Some(file), archive_path: "b.txt".into() },
    ];
    assert!(create_archive_entries(ArchiveFormat::Gz, &two, &workspace.0.join("x.gz"), 6, None,
        None, &cancelled, |_| {}, None).is_err());
    let tgz = workspace.0.join("bundle.tgz");
    create_archive_entries(ArchiveFormat::Tgz, &two, &tgz, 6, None, None, &cancelled, |_| {}, None)
        .unwrap();
    let listing = list_archive(&tgz).unwrap();
    let names: Vec<_> = listing.entries.iter().map(|entry| entry.path.clone()).collect();
    assert_eq!(names, ["a.txt", "b.txt"], "{names:?}");
    assert!(fs::read_dir(&workspace.0).unwrap().all(|entry| {
        !entry.unwrap().file_name().to_string_lossy().contains(".silk-zip-")
    }));
}

#[test]
fn xz_compresses_one_file_with_lzma2() {
    let workspace = Workspace::new();
    let file = workspace.0.join("hello.txt");
    fs::write(&file, b"hello hello hello hello").unwrap();
    let cancelled = Arc::new(AtomicBool::new(false));
    let single = [CreateInput { source_path: Some(file.clone()), archive_path: "hello.txt".into() }];
    for level in [1u8, 6, 9] {
        let output = workspace.0.join(format!("hello-{level}.txt.xz"));
        create_archive_entries(ArchiveFormat::Xz, &single, &output, level, None, None,
            &cancelled, |_| {}, None).unwrap();
        assert_eq!(&fs::read(&output).unwrap()[..6], &[0xfd, b'7', b'z', b'X', b'Z', 0]);
    }
    let two = [
        CreateInput { source_path: Some(file.clone()), archive_path: "a.txt".into() },
        CreateInput { source_path: Some(file), archive_path: "b.txt".into() },
    ];
    assert!(create_archive_entries(ArchiveFormat::Xz, &two, &workspace.0.join("x.xz"), 6, None,
        None, &cancelled, |_| {}, None).is_err());
    assert!(create_archive_entries(ArchiveFormat::Xz, &single, &workspace.0.join("x.xz"), 6,
        Some("pw"), None, &cancelled, |_| {}, None).is_err());
}

#[test]
fn seven_zip_stores_folders_files_and_supports_a_password() {
    let workspace = Workspace::new();
    let file = workspace.0.join("a.txt");
    fs::write(&file, b"seven zip payload seven zip payload").unwrap();
    let other = workspace.0.join("b.txt");
    fs::write(&other, b"a different file body").unwrap();
    let cancelled = Arc::new(AtomicBool::new(false));
    let inputs = [
        CreateInput { source_path: None, archive_path: "dir".into() },
        CreateInput { source_path: Some(file), archive_path: "dir/a.txt".into() },
        CreateInput { source_path: Some(other), archive_path: "b.txt".into() },
    ];
    for level in [1u8, 6, 9] {
        let output = workspace.0.join(format!("out-{level}.7z"));
        let result = create_archive_entries(ArchiveFormat::SevenZip, &inputs, &output, level, None,
            None, &cancelled, |_| {}, None).unwrap();
        assert_eq!(result.entries, 3);
        assert_eq!(&fs::read(&output).unwrap()[..6], &[b'7', b'z', 0xBC, 0xAF, 0x27, 0x1C]);
        let listing = list_archive(&output).unwrap();
        let mut names: Vec<_> = listing.entries.iter().map(|entry| entry.path.trim_end_matches('/').to_string()).collect();
        names.sort();
        assert_eq!(names, ["b.txt", "dir", "dir/a.txt"], "{names:?}");
    }
    let encrypted = workspace.0.join("secret.7z");
    create_archive_entries(ArchiveFormat::SevenZip, &inputs, &encrypted, 6, Some("pw"), None,
        &cancelled, |_| {}, None).unwrap();
    assert!(!fs::read(&encrypted).unwrap().windows(5).any(|bytes| bytes == b"b.txt"));
    assert!(create_archive_entries(ArchiveFormat::Tar, &inputs, &workspace.0.join("s.tar"), 1,
        None, Some(1 << 20), &cancelled, |_| {}, None).is_err());
}

#[test]
fn seven_zip_splits_into_numbered_volumes_that_join_into_one_archive() {
    let workspace = Workspace::new();
    let mut state = 0x9E3779B9u32;
    let data: Vec<u8> = (0..300_000)
        .map(|_| {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            (state >> 24) as u8
        })
        .collect();
    let file = workspace.0.join("blob.bin");
    fs::write(&file, &data).unwrap();
    let cancelled = Arc::new(AtomicBool::new(false));
    let inputs = [CreateInput { source_path: Some(file), archive_path: "blob.bin".into() }];
    let output = workspace.0.join("parts.7z");
    fs::write(workspace.0.join("parts.7z.009"), b"stale").unwrap();
    let split = 64 * 1024;
    let result = create_archive_entries(ArchiveFormat::SevenZip, &inputs, &output, 1, None,
        Some(split), &cancelled, |_| {}, None).unwrap();
    assert!(result.path.ends_with("parts.7z.001"), "{}", result.path);
    assert!(!output.exists());
    assert!(!workspace.0.join("parts.7z.009").exists());
    let mut joined = Vec::new();
    let mut count = 0;
    loop {
        let part = workspace.0.join(format!("parts.7z.{:03}", count + 1));
        let Ok(bytes) = fs::read(&part) else { break };
        count += 1;
        assert!(bytes.len() as u64 <= split);
        joined.extend(bytes);
    }
    assert!(count >= 4, "{count}");
    assert_eq!(joined.len() as u64, result.size);
    assert_eq!(&joined[..6], &[b'7', b'z', 0xBC, 0xAF, 0x27, 0x1C]);
    let whole = workspace.0.join("whole.7z");
    fs::write(&whole, &joined).unwrap();
    let names: Vec<_> = list_archive(&whole).unwrap().entries.iter().map(|e| e.path.clone()).collect();
    assert_eq!(names, ["blob.bin"]);
}
