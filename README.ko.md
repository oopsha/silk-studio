<img src="apps/silk-db-studio/src-tauri/icons/icon.png" width="72" align="left" alt="" />

# Silk Studio

**AI를 품은 데이터베이스 스튜디오** — Oracle, PostgreSQL, MySQL, MariaDB, SQL Server를 위한 데스크톱 DB 클라이언트 **Silk DB Studio**와, 그 주변 도구들을 담은 모노레포입니다.

<br clear="left"/>

[![CI](https://github.com/oopsha/silk-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/oopsha/silk-studio/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/oopsha/silk-studio?include_prereleases&label=release)](https://github.com/oopsha/silk-studio/releases)
![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-informational)

> ⚠️ **베타** — 현재 SQL Server / Oracle 환경 위주로 실사용 검증되었습니다. PostgreSQL / MySQL / MariaDB는 기본 기능(연결·쿼리·오브젝트 탐색) 검증까지만 완료된 상태로, 계속 피드백을 받고 있습니다.

## 다운로드

- **[silkstudio.co.kr →](https://silkstudio.co.kr)** — OS별 설치 가이드 포함
- **[GitHub Releases →](https://github.com/oopsha/silk-studio/releases)** (Windows `.exe`/`.msi`, macOS `.dmg`, arm64/x64 각각 제공)

설치 파일에 **jdbc-agent**와 **Eclipse Temurin JRE 17**이 번들되어 있어 시스템에 Java를 따로 설치할 필요가 없습니다.

## 문서

- **Readme**: [English](README.md) · [한국어](README.ko.md)
- **사용자 가이드**: [한국어](docs/user-guide.ko.md) · [English](docs/user-guide.md)

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| AI 어시스턴트 (BYOK) | 자연어로 SQL 생성, 실행 전 diff 검토, 호출 비용/토큰 감사 로그 |
| PL/SQL 스냅샷 · Diff · 롤백 | 프로시저·함수·트리거 저장 시마다 로컬 스냅샷, 변경 diff 확인 후 즉시 롤백 |
| 안전한 UPDATE | PK 없는 테이블은 UPDATE 차단, 실행 전 변경될 행 미리보기 |
| 서버 사이드 페이징 | 대용량 결과도 서버 페이징·필터·정렬로 가볍게 탐색, 그리드에서 바로 수정 |
| 멀티 세션 | 에디터 탭마다 독립된 연결·실행 결과, 종료 후에도 세션 복원(Hot Exit) |
| 전 연결 대상 검색 | `Ctrl+Shift+O`로 연결된 모든 프로필의 테이블·뷰·프로시저 검색 |
| SSM & SSH 터널 | AWS SSM 포트 포워딩·SSH 점프호스트를 내장해 사설망 DB에 바로 연결 |
| Zero-dependency 런타임 | JDBC 에이전트 + JRE 번들, 별도 설치 없이 바로 연결 |

## 워크스페이스

- `apps/silk-db-studio` — Tauri 데스크톱 DB 스튜디오 및 DB 전용 UI
- `packages/silk-editor` — Monaco 에디터, 에디터 상태, 탭 바
- `packages/silk-workbench` — 커맨드, 메뉴, 레이아웃 서비스, 워크벤치 뷰
- `packages/silk-ui` — 디자인 토큰, 폰트, 아이콘, 공용 UI 훅
- `packages/db-protocol` — Java/Rust/TypeScript 에이전트 프로토콜 계약
- `packages/jdbc-agent` — 공용 Java JDBC 사이드카
- `crates/silk-db-agent-client` — 공용 Rust 프로세스 및 프로토콜 클라이언트

의존성 방향:

```text
silk-ui <- silk-editor <- silk-workbench <- silk-db-studio
                    db-protocol <- silk-db-studio
jdbc-agent <- silk-db-agent-client <- silk-db-studio (Tauri)
```

## 개발

요구 사항: **Node.js 22+**, **pnpm 11** (`package.json#packageManager` — Corepack 권장).

```powershell
corepack enable
pnpm install
cd packages/jdbc-agent
.\gradlew.bat build
cd ../..
pnpm --filter @silk-studio/db-studio tauri dev
```

첫 실행 후 좌측 Activity Bar의 **연결(Connections)** 아이콘 → **새 연결**(또는 상단 메뉴 **연결 → New Connection**)로 프로필을 만들고 연결하세요.
