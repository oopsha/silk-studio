use silk_archive::list_archive;
use std::{fs, path::PathBuf};

fn fixture(name: &str, contents: &[u8]) -> PathBuf {
    let root = std::env::temp_dir().join(format!("silk-archive-test-{}", std::process::id()));
    fs::create_dir_all(&root).unwrap();
    let path = root.join(name);
    fs::write(&path, contents).unwrap();
    path
}

#[test]
fn reads_empty_zip_with_unicode_filesystem_path() {
    let mut data = b"PK\x05\x06".to_vec();
    data.resize(22, 0);
    let path = fixture("빈 압축 파일.zip", &data);
    let result = list_archive(&path).unwrap();
    assert!(result.entries.is_empty());
    assert!(result.engine.contains("libarchive"));
    assert!(result.format.contains("ZIP"));
    fs::remove_file(path).unwrap();
}

#[test]
fn rejects_plain_text_and_missing_file() {
    let path = fixture(
        "not-an-archive.zip",
        b"this is plain text, not a ZIP archive",
    );
    assert!(list_archive(&path).is_err());
    fs::remove_file(&path).unwrap();
    assert!(list_archive(&path).is_err());
}

#[test]
fn reads_compressed_zip_names_sizes_and_directories() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample.zip");
    let result = list_archive(&path).unwrap();
    assert_eq!(result.entries.len(), 2);
    assert_eq!(result.entries[0].path, "폴더/");
    assert!(result.entries[0].directory);
    assert_eq!(result.entries[1].path, "폴더/한글.txt");
    assert_eq!(result.entries[1].size, Some(5));
    assert!(!result.entries[1].encrypted);
}

#[test]
fn reads_tar_with_gzip_filter() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample.tar.gz");
    let result = list_archive(&path).unwrap();
    assert_eq!(result.entries.len(), 1);
    assert_eq!(result.entries[0].path, "folder/hello.txt");
    assert_eq!(result.entries[0].size, Some(5));
}

#[test]
fn reads_rar_and_rar5_headers() {
    for name in ["rar.rar", "rar5.rar"] {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name);
        let listing = list_archive(&path).unwrap();
        assert!(!listing.entries.is_empty());
        assert!(listing.format.to_uppercase().contains("RAR"));
        assert!(listing
            .entries
            .iter()
            .any(|entry| entry.path.ends_with(".txt")));
    }
}

#[test]
fn reads_lzma_7z_headers() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample.7z");
    let listing = list_archive(&path).unwrap();
    assert_eq!(listing.entries.len(), 1);
    assert!(listing.entries[0].path.ends_with("README.md"));
    assert!(listing.format.contains("7-Zip"));
}
