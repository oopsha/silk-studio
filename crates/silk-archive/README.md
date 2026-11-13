# Silk Archive

Tauri, React, 앱 설정에 의존하지 않는 공통 Rust 압축 엔진입니다.
DB Studio와 BE Studio에서도 `silk-archive` 의존성을 추가해 사용할 수 있습니다.
현재 제공 API는 `list_archive(&Path)`이며 압축 파일을 변경하거나 풀지 않습니다.
RAR/RAR5는 읽기·압축 풀기 대상으로만 구현합니다.
7-Zip은 ZIP/7z 성능을 측정한 뒤 필요할 때 추가합니다.

## Windows 빌드

Visual Studio C++ 빌드 도구와 CMake가 필요합니다.
vcpkg는 저장소의 `.local/vcpkg` 또는 `VCPKG_ROOT`에 준비합니다.
개발에 사용한 vcpkg 커밋: `af2c387aa62cf2d0909cd50f4049f2bee1ab682b`.

```powershell
git clone https://github.com/microsoft/vcpkg.git .local/vcpkg
git -C .local/vcpkg checkout af2c387aa62cf2d0909cd50f4049f2bee1ab682b
.local/vcpkg/bootstrap-vcpkg.bat -disableMetrics
.local/vcpkg/vcpkg.exe install "libarchive[core,bzip2,lzma,lz4,zstd,xar]:x64-windows-static-md"
cargo test -p silk-archive
```

Windows ARM64는 `arm64-windows-static-md`를 사용합니다. 정적으로 연결하므로
사용자 PC에 libarchive DLL을 별도로 설치하지 않습니다.

## macOS 빌드

```sh
brew install libarchive pkg-config
export PKG_CONFIG_PATH="$(brew --prefix libarchive)/lib/pkgconfig:${PKG_CONFIG_PATH}"
cargo test -p silk-archive
```

`pkg-config --static`에 해당하는 연결을 사용합니다. 배포 전 Intel과 Apple Silicon
각각에서 실제 파일 검증과 `otool -L`로 Homebrew 경로에 대한 동적 의존성 확인이 필요합니다.
macOS 실행 검증은 Windows에서 수행한 검사와 별개입니다.

## 범위와 배포

- 지원 코덱은 연결한 libarchive의 빌드 옵션에 따라 달라집니다.
- 목록 읽기는 무결성 검사와 다릅니다. 데이터 손상 여부 전체를 보장하지 않습니다.
- 비밀번호 입력 및 다중 볼륨 파일 선택은 다음 단계에서 구현합니다.
- 파일 이름을 정상적으로 읽지 못하면 대체 이름으로 숨기지 않고 오류를 반환합니다.
- 현재 목록 한도는 10만 항목, 파일 이름 합계 16MB입니다. 초과 시 오류를 반환합니다.
- libarchive 및 정적 연결된 코덱의 저작권·라이선스 문서를 배포물에 포함해야 합니다.
  Windows는 vcpkg `installed/<triplet>/share/*/copyright`, macOS는 실제 연결한
  패키지별 LICENSE/COPYING을 기준으로 수집해야 합니다.
- 기본 엔진이 지원하는 모든 형식이 검증된 제품 지원 형식은 아닙니다.
