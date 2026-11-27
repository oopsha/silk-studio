//! Which entries the Explorer menu shows for a selection, and the names in them. Plain data,
//! no Windows calls, so both the extension DLL and the app use it.
use std::path::{Path, PathBuf};

const ARCHIVE_EXTENSIONS: &[&str] = &[
    "zip", "zipx", "tar", "tgz", "taz", "gz", "gzip", "bz2", "xz", "txz", "lz", "lzma", "lzh", "lha", "iso", "7z",
    "zpaq", "rar", "rar5",
];

/// Longest file name shown inside a label before it is shortened.
const NAME_LIMIT: usize = 40;

#[derive(Debug, Clone)]
pub struct Selected {
    pub path: PathBuf,
    pub is_dir: bool,
}

#[derive(Debug, PartialEq)]
pub struct Entry {
    pub label: String,
    pub action: &'static str,
}

fn entry(label: impl Into<String>, action: &'static str) -> Entry {
    Entry { label: label.into(), action }
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default()
}

fn is_archive(item: &Selected) -> bool {
    !item.is_dir
        && item.path.extension().is_some_and(|extension| {
            let extension = extension.to_string_lossy().to_ascii_lowercase();
            ARCHIVE_EXTENSIONS.contains(&extension.as_str())
        })
}

fn strip_extension(name: &str) -> &str {
    name.rsplit_once('.').map_or(name, |(stem, _)| stem)
}

/// "a.tar.gz" -> "a", "a.7z.001" -> "a" (the same rule as `archiveStem` in the app).
fn archive_stem(name: &str) -> String {
    let mut stem = name;
    if let Some((rest, extension)) = stem.rsplit_once('.') {
        let digits = extension.len() == 3 && extension.bytes().all(|byte| byte.is_ascii_digit());
        let volume = extension.len() == 3
            && extension.starts_with(['z', 'Z'])
            && extension.bytes().skip(1).all(|byte| byte.is_ascii_digit());
        if digits || volume {
            stem = rest;
        }
    }
    let tar = stem.rsplit_once('.').and_then(|(rest, extension)| {
        let (head, middle) = rest.rsplit_once('.')?;
        (middle.eq_ignore_ascii_case("tar") && extension.bytes().all(|byte| byte.is_ascii_alphanumeric()))
            .then_some(head)
    });
    let stem = tar.unwrap_or_else(|| strip_extension(stem));
    if stem.is_empty() { name.to_string() } else { stem.to_string() }
}

/// Name of the archive a one-click compression would create, without the extension.
fn output_stem(items: &[Selected]) -> String {
    match items {
        [only] if only.is_dir => file_name(&only.path),
        [only] => archive_stem(&file_name(&only.path)),
        _ => items
            .first()
            .and_then(|item| item.path.parent())
            .map(file_name)
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "새 압축".into()),
    }
}

/// The file name the app will really use: it adds " (2)" when the plain name is taken.
fn free_name(items: &[Selected], extension: &str, exists: &dyn Fn(&Path) -> bool) -> String {
    let stem = output_stem(items);
    let folder = items.first().and_then(|item| item.path.parent()).unwrap_or(Path::new(""));
    let plain = format!("{stem}.{extension}");
    if !exists(&folder.join(&plain)) {
        return plain;
    }
    (2..100)
        .map(|number| format!("{stem} ({number}).{extension}"))
        .find(|name| !exists(&folder.join(name)))
        .unwrap_or(plain)
}

/// A file name as menu text: shortened in the middle, `&` shown literally.
fn shown(name: &str) -> String {
    let letters: Vec<char> = name.chars().collect();
    let short = if letters.len() > NAME_LIMIT {
        let head: String = letters[..NAME_LIMIT - 15].iter().collect();
        let tail: String = letters[letters.len() - 12..].iter().collect();
        format!("{head}...{tail}")
    } else {
        name.to_string()
    };
    short.replace('&', "&&")
}

/// `"name" 폴더에 풀기` for an archive, also used by the app's folder dialog.
/// `folder` is where the new folder would be made, so a taken name shows as "name (2)".
pub fn named_folder_label(archive: &Path, folder: &Path, exists: &dyn Fn(&Path) -> bool) -> String {
    format!("\"{}\" 폴더에 풀기", shown(&free_folder(archive, folder, exists)))
}

/// The folder "extract to the archive's folder" will really make: "name", or "name (2)" when taken.
fn free_folder(archive: &Path, folder: &Path, exists: &dyn Fn(&Path) -> bool) -> String {
    let stem = archive_stem(&file_name(archive));
    if !exists(&folder.join(&stem)) {
        return stem;
    }
    (2..100)
        .map(|number| format!("{stem} ({number})"))
        .find(|name| !exists(&folder.join(name)))
        .unwrap_or(stem)
}

/// Menu entries in groups; a separator goes between groups.
pub fn build(items: &[Selected], exists: &dyn Fn(&Path) -> bool) -> Vec<Vec<Entry>> {
    if items.is_empty() {
        return Vec::new();
    }
    let single = items.len() == 1;
    let mut groups = Vec::new();
    if items.iter().all(is_archive) {
        let mut extract = Vec::new();
        if single {
            extract.push(entry("Silk Zip으로 열기(&O)", "open"));
        }
        extract.push(entry("여기에 풀기(&X)", "extract-here"));
        extract.push(if single {
            let archive = &items[0].path;
            let label = named_folder_label(archive, archive.parent().unwrap_or(Path::new("")), exists);
            entry(format!("{label}(&E)"), "extract-folder")
        } else {
            entry("각각 파일명 폴더에 풀기(&E)", "extract-folder")
        });
        extract.push(entry("Silk Zip으로 압축 풀기(&T)...", "extract-dialog"));
        groups.push(extract);
        // One archive is rarely compressed again; several may still be bundled into one.
        if single {
            return groups;
        }
    }
    let zip = shown(&free_name(items, "zip", exists));
    let seven = shown(&free_name(items, "7z", exists));
    let mut compress = vec![
        entry(format!("\"{zip}\"(으)로 압축하기(&Z)"), "compress-zip"),
        entry(format!("\"{seven}\"(으)로 압축하기(&7)"), "compress-7z"),
    ];
    if !single {
        compress.push(entry("각각 ZIP으로 압축하기(&U)", "compress-each"));
    }
    compress.push(entry("Silk Zip으로 압축하기(&L)...", "compress-dialog"));
    groups.push(compress);
    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str) -> Selected {
        Selected { path: path.into(), is_dir: false }
    }

    fn actions(groups: &[Vec<Entry>]) -> Vec<&str> {
        groups.iter().flatten().map(|entry| entry.action).collect()
    }

    fn labels(groups: &[Vec<Entry>]) -> Vec<&str> {
        groups.iter().flatten().map(|entry| entry.label.as_str()).collect()
    }

    #[test]
    fn single_archive_shows_its_name() {
        let groups = build(&[file(r"C:\work\새 압축.zip")], &|_| false);
        assert_eq!(actions(&groups), ["open", "extract-here", "extract-folder", "extract-dialog"]);
        assert!(labels(&groups).contains(&"\"새 압축\" 폴더에 풀기(&E)"));
    }

    #[test]
    fn taken_folder_name_is_numbered() {
        let groups = build(&[file(r"C:\work\test.tar")], &|path| path.ends_with("test"));
        assert!(labels(&groups).contains(&"\"test (2)\" 폴더에 풀기(&E)"));
    }

    #[test]
    fn single_file_shows_the_name_that_will_be_written() {
        let groups = build(&[file(r"C:\work\새 압축.txt")], &|path| path.ends_with("새 압축.zip"));
        assert_eq!(actions(&groups), ["compress-zip", "compress-7z", "compress-dialog"]);
        assert!(labels(&groups).contains(&"\"새 압축 (2).zip\"(으)로 압축하기(&Z)"));
    }

    #[test]
    fn many_items_offer_each_and_use_the_folder_name() {
        let groups = build(&[file(r"C:\work\a.txt"), file(r"C:\work\b.zip")], &|_| false);
        assert_eq!(actions(&groups), ["compress-zip", "compress-7z", "compress-each", "compress-dialog"]);
        assert!(labels(&groups).contains(&"\"work.zip\"(으)로 압축하기(&Z)"));
        let archives = build(&[file(r"C:\work\a.zip"), file(r"C:\work\b.7z")], &|_| false);
        assert_eq!(actions(&archives)[..2], ["extract-here", "extract-folder"]);
    }

    #[test]
    fn names_follow_the_app_rules() {
        assert_eq!(archive_stem("a.tar.gz"), "a");
        assert_eq!(archive_stem("a.7z.001"), "a");
        assert_eq!(archive_stem("v1.2.zip"), "v1.2");
        assert_eq!(archive_stem(".zip"), ".zip");
        let folder = Selected { path: r"C:\work\v1.2".into(), is_dir: true };
        assert_eq!(output_stem(&[folder]), "v1.2");
    }

    #[test]
    fn long_names_and_ampersands() {
        assert_eq!(shown("A&B"), "A&&B");
        assert_eq!(shown(&"가".repeat(60)).chars().count(), 25 + 3 + 12);
    }
}
