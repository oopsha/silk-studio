fn main() {
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        let mut config = vcpkg::Config::new();
        if std::env::var_os("VCPKG_ROOT").is_none() {
            config.vcpkg_root(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.local/vcpkg"),
            );
        }
        let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap();
        let triplet = match arch.as_str() {
            "x86_64" => "x64-windows-static-md",
            "aarch64" => "arm64-windows-static-md",
            _ => panic!("Unsupported Windows architecture: {arch}"),
        };
        let library = config
            .target_triplet(triplet)
            .find_package("libarchive")
            .expect("libarchive is required: see crates/silk-archive/README.md");
        require_archive3(&library.include_paths);
        for system_library in [
            "bcrypt", "crypt32", "advapi32", "user32", "xmllite", "ole32", "ws2_32",
        ] {
            println!("cargo:rustc-link-lib={system_library}");
        }
    } else {
        let library = pkg_config::Config::new()
            .statik(true)
            .atleast_version("3.8.9")
            .probe("libarchive")
            .expect("Install the libarchive development package before building Silk Archive");
        require_archive3(&library.include_paths);
        if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
            assert!(
                library
                    .link_paths
                    .iter()
                    .any(|path| path.join("libarchive.a").is_file()),
                "A static libarchive.a is required for macOS distribution"
            );
        }
    }
}

fn require_archive3(paths: &[std::path::PathBuf]) {
    let header = paths
        .iter()
        .find_map(|path| std::fs::read_to_string(path.join("archive.h")).ok())
        .expect("libarchive development headers are missing");
    let version = header
        .lines()
        .find_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            (fields.len() >= 3 && fields[1] == "ARCHIVE_VERSION_NUMBER")
                .then(|| fields[2].parse::<u32>().ok())
                .flatten()
        })
        .expect("Cannot determine libarchive ABI version");
    assert!(
        (3_008_009..3_999_000).contains(&version),
        "This FFI layer requires libarchive 3.8.9 or newer in the 3.x ABI"
    );
}
