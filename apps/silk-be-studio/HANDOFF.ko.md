# Silk BE Studio 인수인계

> 마지막 갱신: 2026-09-26

## 현재 상태

- 제품은 기획 단계이며, 앱 코드나 패키지 설정은 아직 만들지 않았다.
- 장기 방향과 지원 단계는 [로드맵](./ROADMAP.ko.md)에 기록되어 있다.
- `apps/silk-be-studio`는 계획된 앱 경로다. 현재 저장소의 `pnpm-workspace.yaml`은 `apps/*`를 포함하므로, 향후 앱에 `package.json`을 추가하면 기존 워크스페이스 규칙을 따를 수 있다.

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
- `silk-editor`와 `silk-workbench`에는 Tauri API 의존성이 있다. 공용 패키지를 그대로 공유할 수 있는지, 앱 전용 동작을 분리해야 하는지 구현 전에 확인해야 한다.
- DB Studio와 BE Studio는 별도 앱으로 두고, 실제로 양쪽에서 필요한 기반만 공유하는 방향이 현재 제안이다. 통합 배포나 공통 설정 공유 방식은 미결정이다.

## 다음 작업

1. 현재 `silk-db-studio`의 앱 초기화, Tauri 명령, 파일 시스템 접근 방식을 살펴본다.
2. `silk-editor`, `silk-workbench`, `silk-ui`에서 재사용 가능한 부분과 앱 전용 부분을 구분한다.
3. Spring Boot(Java) 첫 버전의 최소 사용자 흐름을 정한다: 프로젝트 열기, Maven/Gradle 감지, 실행·중지, 로그 확인, API 확인, DB 연결 중 초기 릴리스에 넣을 항목을 결정한다.
4. Java 코드 탐색·진단·자동완성 및 디버깅을 외부 언어 도구와 어떻게 연결할지 조사하고, 의존성과 라이선스를 포함해 기술 선택지를 비교한다.
5. 위 결정을 반영해 0단계 완료 기준과 첫 구현 단위를 로드맵에 구체화한다.

## 아직 결정하지 않은 사항

- Kotlin 지원 시점
- Java 언어 지원과 디버깅에 사용할 도구 및 배포 방식
- API 요청 도구를 내장할지 기존 도구와 연동할지
- DB Studio를 별도 실행 앱으로 연결할지, 공통 기능을 공유할지
- Spring Initializr 프로젝트 생성 지원 여부
- Node.js, Python, PHP에서 첫 지원 프레임워크
- 첫 릴리스의 지원 OS와 배포 방식
