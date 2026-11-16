use silk_archive::{create_zip_entries, list_archive, CreateInput};
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
};

static NEXT: AtomicU64 = AtomicU64::new(0);
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
