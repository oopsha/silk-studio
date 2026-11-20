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
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let sdk_root = manifest.join("third_party/7zip");
    let sdk_cpp = sdk_root.join("CPP");
    let compression = vcpkg::Config::new()
        .vcpkg_root(vcpkg_root.clone())
        .target_triplet(triplet)
        .find_package("zlib-ng")
        .expect("Install the zlib-ng vcpkg port for this target");

    let list = std::fs::read_to_string(sdk_root.join("sources.txt"))
        .expect("third_party/7zip/sources.txt is missing");
    let mut c_files = Vec::new();
    let mut cpp_files = Vec::new();
    for line in list.lines().map(str::trim).filter(|line| !line.is_empty()) {
        println!("cargo:rerun-if-changed=third_party/7zip/{line}");
        let path = sdk_root.join(line);
        if line.ends_with(".c") { c_files.push(path) } else { cpp_files.push(path) }
    }
    if target_os != "windows" {
        cpp_files.push(sdk_cpp.join("Common/MyWindows.cpp"));
    }
    let configure = |build: &mut cc::Build| {
        build.opt_level(2).include(&sdk_cpp);
        for include in &compression.include_paths {
            build.include(include);
        }
        build.define("Z7_EXTERNAL_CODECS", None).define("Z7_PPMD_SUPPORT", None);
        if target_os == "windows" {
            build.define("UNICODE", None).define("_UNICODE", None);
        } else {
            build
                .define("_REENTRANT", None)
                .define("_FILE_OFFSET_BITS", "64")
                .define("_LARGEFILE_SOURCE", None);
        }
    };
    // Vendored 7-Zip sources: warnings are upstream's concern.
    let mut sdk_c = cc::Build::new();
    configure(&mut sdk_c);
    sdk_c.files(&c_files).warnings(false).compile("silk_7zip_c");
    let mut sdk_cpp_build = cc::Build::new();
    configure(&mut sdk_cpp_build);
    // The SDK registers formats and codecs from static initializers, so every object
    // must be linked even when nothing references it.
    sdk_cpp_build.cpp(true).std("c++17").files(&cpp_files).warnings(false).cargo_metadata(false);
    sdk_cpp_build.compile("silk_7zip_cpp");
    println!("cargo:rustc-link-search=native={}", std::env::var("OUT_DIR").unwrap());
    println!("cargo:rustc-link-lib=static:+whole-archive=silk_7zip_cpp");
    let mut adapter = cc::Build::new();
    configure(&mut adapter);
    adapter
        .cpp(true)
        .std("c++17")
        .file("src/seven_zip_sdk.cpp")
        .warnings(true)
        .compile("silk_7zip_adapter");
    println!("cargo:rerun-if-changed=src/seven_zip_sdk.cpp");
    println!("cargo:rerun-if-changed=src/parallel_deflate.h");

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
            "bcrypt", "crypt32", "advapi32", "user32", "xmllite", "ole32", "oleaut32", "ws2_32",
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
