# Silk Archive

Tauri, React, 앱 설정에 의존하지 않는 공통 Rust 압축 엔진입니다.
DB Studio와 BE Studio에서도 `silk-archive` 의존성을 추가해 사용할 수 있습니다.
현재 제공 API는 압축 파일 목록 읽기와 ZIP 생성(`create_zip`)입니다.
일반 ZIP과 분할 ZIP 모두 7-Zip SDK로 압축 데이터를 생성합니다. 분할 ZIP은 임시 일반 ZIP의 로컬 항목과 중앙 디렉터리를 재배치해 PKWARE 다중 디스크 구조로 기록합니다. 두 생성 경로 모두 입력 파일과 선택 폴더, ZipCrypto 암호, 취소와 진행률 콜백을 지원합니다.
RAR/RAR5는 읽기·압축 풀기 대상으로만 구현합니다.

## Windows 빌드

Visual Studio C++ 빌드 도구와 CMake가 필요합니다.
vcpkg는 저장소의 `.local/vcpkg` 또는 `VCPKG_ROOT`에 준비합니다.
개발에 사용한 vcpkg 커밋: `af2c387aa62cf2d0909cd50f4049f2bee1ab682b`.

```powershell
git clone https://github.com/microsoft/vcpkg.git .local/vcpkg
git -C .local/vcpkg checkout af2c387aa62cf2d0909cd50f4049f2bee1ab682b
.local/vcpkg/bootstrap-vcpkg.bat -disableMetrics
.local/vcpkg/vcpkg.exe install "7zip:x64-windows-static-md" "zlib-ng:x64-windows-static-md" "libarchive[core,bzip2,lzma,lz4,zstd,xar]:x64-windows-static-md"
cargo test -p silk-archive
```

Windows ARM64는 `arm64-windows-static-md`를 사용합니다. libarchive와 7-Zip SDK를
정적으로 연결하므로 사용자 PC에 해당 DLL을 별도로 설치하지 않습니다.
7-Zip 어댑터는 vcpkg가 내려받은 SDK의 전체 헤더를 사용하므로 vcpkg 바이너리 캐시만으로는 빌드할 수 없습니다. 7zip 포트 소스가 `VCPKG_ROOT/buildtrees/7zip/src`에 있어야 합니다.

## macOS 빌드

```sh
brew install libarchive pkg-config
git clone https://github.com/microsoft/vcpkg.git .local/vcpkg
git -C .local/vcpkg checkout af2c387aa62cf2d0909cd50f4049f2bee1ab682b
.local/vcpkg/bootstrap-vcpkg.sh -disableMetrics
VCPKG_TRIPLET=arm64-osx # Apple Silicon; use x64-osx for Intel
.local/vcpkg/vcpkg install "7zip:${VCPKG_TRIPLET}" "zlib-ng:${VCPKG_TRIPLET}" --disable-metrics
export VCPKG_ROOT="$PWD/.local/vcpkg"
export PKG_CONFIG_PATH="$(brew --prefix libarchive)/lib/pkgconfig:${PKG_CONFIG_PATH}"
cargo test -p silk-archive
```

`pkg-config --static`에 해당하는 연결을 사용합니다. 배포 전 Intel과 Apple Silicon
각각에서 실제 파일 검증과 `otool -L`로 Homebrew 경로에 대한 동적 의존성 확인이 필요합니다.
macOS 실행 검증은 Windows에서 수행한 검사와 별개입니다.
vcpkg의 7zip 포트도 소스에서 빌드되어야 하며, 전체 SDK 헤더는 `VCPKG_ROOT/buildtrees/7zip/src`에서 사용합니다.

## 범위와 배포

- 지원 코덱은 연결한 libarchive의 빌드 옵션에 따라 달라집니다.
- 목록 읽기는 무결성 검사와 다릅니다. 데이터 손상 여부 전체를 보장하지 않습니다.
- ZIP 비밀번호 압축은 호환성을 위해 ZipCrypto를 사용합니다. ZipCrypto는 보안이 약합니다.
- 분할 ZIP은 PKWARE 디스크 분할 구조로 저장하며, 조각 이름은 `.z01`, `.z02` ...와 마지막 `.zip`을 사용합니다.
- 일반 ZIP과 분할 ZIP 생성 및 분할 ZIP 목록 읽기는 7-Zip SDK를 사용합니다. 일반 압축 파일 목록 읽기는 libarchive를 사용합니다.
- 분할 재작성은 ZIP64 항목 크기와 ZIP64 끝 레코드, 일반/ZIP64 데이터 설명자를 처리합니다.
- 파일 이름을 정상적으로 읽지 못하면 대체 이름으로 숨기지 않고 오류를 반환합니다.
- 현재 목록 한도는 10만 항목, 파일 이름 합계 16MB입니다. 초과 시 오류를 반환합니다.
- 7-Zip SDK, libarchive 및 정적 연결된 코덱의 저작권·라이선스 문서를 배포물에 포함해야 합니다.
  Windows는 vcpkg `installed/<triplet>/share/*/copyright`, macOS는 실제 연결한
  패키지별 LICENSE/COPYING을 기준으로 수집해야 합니다.
- 기본 엔진이 지원하는 모든 형식이 검증된 제품 지원 형식은 아닙니다.

`create_zip_entries` accepts explicit source paths and archive paths. An entry with no source path creates a directory inside the ZIP without creating a directory on disk. Each entry is written once (source directories are not recursively expanded by this API); callers provide the complete draft listing. Archive paths are relative, use `/`, and must be unique.
