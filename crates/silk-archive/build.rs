fn main() {
    println!("cargo:rerun-if-env-changed=VCPKG_ROOT");

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    let triplet = match (target_os.as_str(), arch.as_str()) {
        ("windows", "x86_64") => "x64-windows-static-md",
        ("windows", "aarch64") => "arm64-windows-static-md",
        ("macos", "x86_64") => "x64-osx",
        ("macos", "aarch64") => "arm64-osx",
        _ => panic!("Unsupported 7-Zip SDK target: {target_os}/{arch}"),
    };
    let vcpkg_root = std::env::var_os("VCPKG_ROOT")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.local/vcpkg")
        });
    let mut sdk_config = vcpkg::Config::new();
    sdk_config.vcpkg_root(vcpkg_root.clone());

    let sdk_cpp = find_7zip_cpp_root(&vcpkg_root);
    let mut sdk_build = cc::Build::new();
    sdk_build
        .cpp(true)
        .std("c++17")
        .file("src/seven_zip_sdk.cpp")
        .file(sdk_cpp.join("7zip/Common/FileStreams.cpp"))
        .include(&sdk_cpp);
    sdk_build
        .define("Z7_EXTERNAL_CODECS", None)
        .define("Z7_PPMD_SUPPORT", None);
    if target_os == "windows" {
        // Match the public compile definitions from the 7-Zip vcpkg target.
        sdk_build.define("UNICODE", None).define("_UNICODE", None);
    } else {
        sdk_build
            .define("_REENTRANT", None)
            .define("_FILE_OFFSET_BITS", "64")
            .define("_LARGEFILE_SOURCE", None);
    }
    sdk_build.warnings(true).compile("silk_7zip_adapter");
    println!("cargo:rerun-if-changed=src/seven_zip_sdk.cpp");
    let _sdk = sdk_config
        .target_triplet(triplet)
        .lib_name("7zip")
        .find_package("7zip")
        .expect("7-Zip SDK is required: see crates/silk-archive/README.md");

    if target_os == "windows" {
        let mut config = vcpkg::Config::new();
        if std::env::var_os("VCPKG_ROOT").is_none() {
            config.vcpkg_root(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.local/vcpkg"),
            );
        }
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
        if target_os == "macos" {
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

fn find_7zip_cpp_root(vcpkg_root: &std::path::Path) -> std::path::PathBuf {
    let sources = vcpkg_root.join("buildtrees/7zip/src");
    let mut candidates = std::fs::read_dir(&sources)
        .unwrap_or_else(|error| {
            panic!(
                "7-Zip SDK source headers are missing at {} ({error}); install the 7zip vcpkg port from source",
                sources.display()
            )
        })
        .filter_map(Result::ok)
        .map(|entry| entry.path().join("CPP"))
        .filter(|cpp| {
            cpp.join("Windows/PropVariant.h").is_file()
                && cpp.join("7zip/Archive/IArchive.h").is_file()
                && cpp.join("7zip/Common/FileStreams.cpp").is_file()
        })
        .collect::<Vec<_>>();
    candidates.sort();
    candidates.pop().unwrap_or_else(|| {
        panic!(
            "Complete 7-Zip SDK headers are missing under {}; reinstall the 7zip vcpkg port from source",
            sources.display()
        )
    })
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
