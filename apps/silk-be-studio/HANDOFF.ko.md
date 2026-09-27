# Silk BE Studio 인수인계

> 마지막 갱신: 2026-09-27

## 현재 상태

- `apps/silk-be-studio`에 pnpm/Tauri 앱 골격을 만들고 DB Studio와 같은 `silk-workbench` 공용 UI를 조합했다. 공용 TitleBar, ActivityBar, Sidebar, SecondarySidebar, StatusBar 및 EditorGroupsView를 연결했다.
- ActivityBar와 Sidebar는 공용 컨테이너이며, 뷰 목록과 화면은 앱이 등록한다. DB Studio는 DB 연결 탐색기·검색·쿼리 기록을, BE Studio는 파일 탐색기·검색·소스 제어·실행 및 디버그 뷰를 등록한다. BE의 후자 세 패널은 현재 자리표시자이며 프로젝트 파일 처리와 Git·실행 기능은 아직 구현하지 않았다.
- `EditorGroupsView`의 분할 레이아웃, 탭 바, 에디터 영역 구현은 `packages/silk-workbench`로 옮겼다. DB Studio도 공용 구현을 사용한다. SQL 결과 패널, 가상 탭 판별, 편집기 간 드래그 콜백과 프로젝트 트리 드롭 속성은 앱별 주입 지점으로 남겼다.
- BE Studio의 파일 탐색기, 검색, 소스 제어, 실행 및 디버그 패널은 현재 화면 골격이며 프로젝트 파일 처리와 Git·실행 기능은 아직 구현하지 않았다.
- 장기 방향과 지원 단계는 [로드맵](./ROADMAP.ko.md)에 기록되어 있다.
- `apps/silk-be-studio`는 pnpm workspace 및 Cargo workspace에 등록되어 있다.
- 0단계의 저장소 구조, 첫 사용자 흐름, 권한·Java 도구 경계 조사를 마쳤다. 결론과 완료 기준은 로드맵에 반영했다.
- 첫 구현으로 Tauri/React 앱, pnpm 및 Cargo workspace 등록, 공용 워크벤치 레이아웃과 편집기 그룹을 구성했다. Spring Boot 프로젝트 생성 버튼은 아직 연결되지 않았다.

## 논의에서 정한 방향

- 목표는 IntelliJ처럼 백엔드 프로젝트 개발을 지원하는 데스크톱 스튜디오다.
- 사용자는 VS Code를 주로 사용했고 IntelliJ 사용 경험은 많지 않다. DB 도구로는 DBeaver를 많이 사용했다.
- 백엔드 지원 목표 순서는 **Spring → Node.js → Python → PHP**다.
- 첫 구체화 대상은 **Spring Boot와 Java**로 둔다. Kotlin은 초기 범위에 확정되지 않았다.
- 코드 편집기만 재현하기보다 프로젝트 실행, 로그, API 확인, Silk DB Studio와의 DB 작업 연결까지 이어지는 흐름을 검토한다.
- 각 언어의 코드 분석·자동완성·디버깅 구현 방식은 아직 결정하지 않았다.

## 저장소 구조 검토 메모

- `apps/silk-db-studio`가 현재 데스크톱 앱이며, React/Vite/Tauri를 사용한다.
- 공용 패키지 후보는 `packages/silk-ui`, `packages/silk-editor`, `packages/silk-workbench`다.
- 편집기 탭·Monaco 기반과 UI 구성 요소는 재사용 후보지만, `silk-editor`와 `silk-workbench`는 Tauri API 및 파일 대화상자·파일 시스템 플러그인에 의존한다. 화면/상태 기반의 재사용 가능성과 앱별 파일 권한·명령 구성을 구분해야 한다.
- DB Studio의 Tauri capability는 파일 시스템 접근을 넓은 경로로 허용하고, 현재 Rust 명령은 DB·연결 관련 기능에 집중되어 있다. BE Studio는 사용자가 선택한 프로젝트 폴더 접근과 서버 프로세스 생명주기 관리를 자체 capability 및 명령으로 설계해야 한다.
- 임의 셸 실행 권한을 노출하기보다, 실행 프로그램·인자·작업 디렉터리를 명시하고 사용자가 확인할 수 있는 앱 관리 프로세스 경계를 둔다. 종료 시 하위 프로세스 정리와 stdout/stderr 전달도 설계 범위다.
- DB Studio와 BE Studio는 별도 앱으로 두고, 실제로 양쪽에서 필요한 기반만 공유하는 방향이 현재 제안이다. 통합 배포나 공통 설정 공유 방식은 미결정이다.

## 첫 구현 흐름 및 기술 검토

- 첫 흐름은 **프로젝트 폴더 열기 → Maven/Gradle 감지 → Spring Boot 실행·중지 → 콘솔 로그 및 종료 상태 확인**으로 구체화했다.
- `pom.xml`, `build.gradle` 또는 `build.gradle.kts`와 래퍼를 확인해 빌드 도구를 표시하는 방향이다. 실행 명령과 옵션은 사용자가 확인·제어할 수 있어야 한다.
- 프로파일 선택, API 요청 도구, DB Studio 연결, 디버깅은 첫 실행·로그 흐름을 검증한 뒤 단계적으로 결정한다. 포트 감지는 최초 필수 조건으로 두지 않고, 로그 기반 준비 상태/URL 표시부터 검토한다.
- Java 언어 지원의 유력 후보는 Eclipse JDT Language Server다. 공식 저장소는 Maven·Gradle, 진단, 자동완성, 탐색 기능을 설명하고 실행에 Java 21 이상을 요구한다. 채택 전 기능 적합성, Eclipse 라이선스 조건, 패키징·업데이트 방식 및 별도 런타임 부담을 확인해야 한다.
- Microsoft `vscode-java-debug`는 Java Debug Server 및 VS Code 확장 통합 형태이므로, 그대로 가져다 쓸 수 있다고 전제하지 않는다. 독립 실행/프로토콜 통합 가능성과 라이선스·배포 조건을 추가 검증한 뒤 디버깅 구현 여부를 정한다.
- Java 언어 서버 실행용 런타임과 프로젝트 빌드에 사용할 JDK를 구분해 사용자 안내와 런타임 탐지 방식을 설계한다.

## 다음 작업

1. pnpm 의존성 링크를 갱신한 뒤 BE Studio를 실행해 공용 워크벤치 연결과 화면을 확인한다.
2. Spring Initializr 프로젝트 생성 흐름을 구현한다.
3. 생성된 프로젝트를 워크벤치에 열고 프로젝트 탐색·편집으로 이어지게 한다. 공용 워크벤치에 필요한 기반이 없으면 앱별 우회 구현을 먼저 넣지 않고 공용화 경계를 함께 검토한다.
5. 서버 프로세스 관리 경계를 설계한 뒤 Maven/Gradle 실행·중지와 로그 확인을 추가한다.
6. JDT LS의 라이선스·배포·런타임 및 Java 디버거 통합 가능성을 검증하고, 이후 프로파일·API·DB 연계 순서를 정한다.

## 아직 결정하지 않은 사항

- Kotlin 지원 시점
- JDT LS 채택 여부와 배포 방식, Java 디버거 도구 및 배포 방식
- API 요청 도구를 내장할지 기존 도구와 연동할지
- DB Studio를 별도 실행 앱으로 연결할지, 공통 기능을 공유할지
- Spring Initializr 프로젝트 생성 지원 여부
- Node.js, Python, PHP에서 첫 지원 프레임워크
- 첫 릴리스의 지원 OS와 배포 방식
