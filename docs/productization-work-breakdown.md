# 제품화 기반 — 작업 배분

로드맵 9번 항목을 한 번에 처리하기엔 범위가 크므로, **요청 6번**으로 나눈다.  
각 요청은 한 채팅에서 end-to-end로 끝낼 수 있는 단위다.  
(형식은 [`ai-assistant-work-breakdown.md`](./ai-assistant-work-breakdown.md) · [`plsql-work-breakdown.md`](./plsql-work-breakdown.md)와 동일)

## 현재 상태 (기준)

- Tauri 2 번들 골격 — [`tauri.conf.json`](../apps/silk-db-studio/src-tauri/tauri.conf.json) (`bundle.active`, 아이콘, **resources: jdbc-agent + jre**)
- jdbc-agent — Gradle Java 17 · thin jar + `lib/` ([`packages/jdbc-agent`](../packages/jdbc-agent/)); 런타임은 **번들 Temurin JRE 17** (없으면 dev에서 PATH `java`)
- 경로 해석 — [`runtime_paths.rs`](../apps/silk-db-studio/src-tauri/src/runtime_paths.rs) (설치본 `resource_dir` → monorepo 폴백)
- 스테이징 — [`scripts/prepare-runtime-resources.mjs`](../scripts/prepare-runtime-resources.mjs) · 가이드 [`docs/bundled-runtime.md`](./bundled-runtime.md)
- 기능별 오류 문자열 — [`formatErrorMessage`](../apps/silk-db-studio/src/services/formatErrorMessage.ts) · [`reportError`](../apps/silk-db-studio/src/services/formatErrorMessage.ts) (진단 로그 연동)
- AI 감사 로그(8-F) — 호출 메타만 (앱 진단 로그와 **별개**)
- 키바인딩 레지스트리·메뉴 accelerator — [`packages/silk-workbench/src/platform/keybinding/`](../packages/silk-workbench/src/platform/keybinding/)
- Help / About · Copy Diagnostics · Open Log Folder — **구현** (`silk.help.*`); Keyboard Shortcuts · Command Palette — **스텁**; **Check for Updates** — **구현** (`update.check` · GitHub Releases `latest.json`)
- 앱 진단 로그 — `app_data_dir/logs/silk-db-studio.log` (로테이션·시크릿 마스킹)
- 내부 작업 문서 — [`docs/roadmap.md`](./roadmap.md), 각 `*-work-breakdown.md`, [`docs/release.md`](./release.md)
- **없음**: 단위/e2e 테스트 · 사용자 가이드 · 체계적 a11y 패스 · OS 코드서명/notarize 자동화(시크릿 슬롯·가이드만)

### v1 범위

- **1차 OS**: macOS · Windows (Linux는 후순위)
- **배포**: GitHub Releases + Tauri updater (서명·notarize는 가이드+시크릿 준비 전제)
- **런타임**: 설치 앱에 **jdbc-agent jar(+lib) + 번들 JRE(또는 동등 런타임)** 포함 → 시스템 Java 없이 연결·쿼리
- v1에서 **넣지 말 것**: 원격 크래시 수집(Sentry 등) 필수화, Linux 1차 지원, Git/Flyway/Liquibase, 서버 프록시

---

## 진행 순서

```
9-A  오류 UX · 로그 · 진단 (Copy diagnostics · About 버전)
 → 9-B  패키징 경로 · 번들 JRE + jdbc-agent 리소스
 → 9-C  Tauri updater · 서명 · GitHub Releases
 → 9-D  단위/통합 테스트 골격 + CI (lint/build)
 → 9-E  e2e(선택) · 플랫폼 매트릭스 (macOS/Windows)
 → 9-F  Help · 단축키 UI · 접근성 · 사용자 문서
```

- **9-A**만, 또는 **9-A + About UI**까지가 한 채팅 상한에 가깝다.
- **9-B**는 JRE 크기·라이선스·Mac/Win 경로가 커서 **단독 요청** 권장 (릴리스 전 필수).
- **9-C**는 서명/시크릿이 필요 — **9-B** 이후, CI 시크릿 준비 후.
- **9-D**는 9-B/C와 **병행** 가능. 제품 “설치·업데이트 본편”은 **9-B + 9-C**.
- **9-E**는 9-D 이후 · 선택적으로 미뤄도 9번 골격은 성립한다.
- **9-F**의 About는 9-A와 겹치면 A에 버전 UI를 넣고, F는 단축키·문서·a11y에 집중.

---

## 9-A. 오류 UX · 로그 · 진단

**상태:** 완료

**의존성:** 없음 (기능 로드맵과 독립)

### 범위

- 전역 오류 표면 (토스트/알림 또는 StatusBar 연계) — `window.alert` 남발을 줄일 수 있으면 점진 교체
- 프론트·(가능 시) Rust 파일 로그 — 앱 데이터 디렉터리, 로테이션·크기 상한
- **Copy diagnostics** — 버전 · OS · 아키텍처 · 최근 오류 · (선택) 연결 상태 요약 · 로그 경로  
  - **API 키·비밀번호·긴 프롬프트 제외**
- Help → **About**: 앱/Tauri/agent 버전 표시 (스텁 해소)
- (선택) “Open log folder”

### 완료 기준

- 사용자가 진단 문자열을 복사해 이슈에 붙일 수 있음
- 로그 파일이 로컬에 쌓이고 About에 버전이 보임

### 구현 메모

- Rust: [`app_log.rs`](../apps/silk-db-studio/src-tauri/src/app_log.rs) — `app_log_write` / `app_runtime_info` / `app_log_open_folder`
- TS: `packages/silk-workbench/src/services/diagnostics/*`, Help 커맨드 `silk.help.about|copyDiagnostics|openLogFolder`
- 토스트: `AppNotificationService` + `AppToast` (Copy diagnostics 피드백 등)
- 시크릿 마스킹: 프론트 `redactSecrets` + Rust `redact_secrets` 이중 방어

### 요청 문구 예

> 오류/로그/진단 기반을 넣어줘. Copy diagnostics와 About 버전, 로컬 로그 파일을 추가해. API 키·비밀번호는 로그에 남기지 마.

---

## 9-B. 패키징 경로 · 번들 JRE + jdbc-agent

**상태:** 완료

**의존성:** jdbc-agent 빌드 산출물. 9-A와 병행 가능하나 **릴리스 전 필수**

### 범위

- 설치본에서 `jdbc-agent` jar + `lib/` **리소스 해석** (개발용 `CARGO_MANIFEST_DIR` 하드코딩 제거)
- **번들 JRE**(또는 문서화된 최소 런타임)로 `Command::new("java")` 대체 — Mac/Win 산출물별 경로
- Tauri `resources` / sidecar / externalBin 중 팀 선택에 맞는 패키징
- [`THIRD_PARTY_NOTICES`](../packages/jdbc-agent/THIRD_PARTY_NOTICES.md) · JRE 라이선스 고지 유지·확장
- (선택) 첫 실행 시 런타임/agent 존재 스모크 + 실패 시 진단 안내(9-A 연계)

### 완료 기준

- **시스템 Java 없이** 설치 앱에서 연결·쿼리가 됨
- Mac·Windows 패키지에 agent(+런타임)가 포함됨

### 구현 메모

- 경로: [`runtime_paths.rs`](../apps/silk-db-studio/src-tauri/src/runtime_paths.rs) · 클라이언트 [`JdbcAgentClient::new(jar, java_bin)`](../crates/silk-db-agent-client/src/lib.rs)
- 스테이징/JRE: [`scripts/prepare-runtime-resources.mjs`](../scripts/prepare-runtime-resources.mjs) (Temurin 17, OS/arch별)
- 번들: `tauri.conf.json` → `bundle.resources` = `resources/jdbc-agent`, `resources/jre`
- 문서: [`docs/bundled-runtime.md`](./bundled-runtime.md)

### 요청 문구 예

> 설치본에 jdbc-agent와 번들 JRE를 넣고, 시스템 Java 없이 연결·쿼리되게 패키징 경로를 고쳐줘. Mac/Windows 모두.

---

## 9-C. 자동 업데이트 · 배포 · GitHub Releases

**상태:** 완료

**의존성:** **9-B** 권장 (업데이트 산출물에 agent/JRE 포함). 서명·시크릿 준비

### 범위

- `tauri-plugin-updater` 연동
- Manage → **Check for Updates…** (`update.check` 스텁 실구현)
- GitHub Releases 아티팩트 · update endpoint(JSON) 구성
- 코드 서명 / macOS notarize / Windows Authenticode — **가이드 + CI 시크릿** (완전 자동화는 환경 준비 후)
- (선택) 릴리스 체크리스트 문서 (`docs/release.md` 등)

### 완료 기준

- 태그(또는 수동) 릴리스로 설치 패키지가 올라가고
- 앱에서 업데이트 확인이 동작함 (서명 환경이 갖춰진 경우)

### 구현 메모

- 플러그인: `tauri-plugin-updater` · `tauri-plugin-process` · capabilities `updater:default` / `process:default`
- 엔드포인트: `https://github.com/oopsha/silk-studio/releases/latest/download/latest.json`
- UI: [`updateService.ts`](../packages/silk-workbench/src/services/updates/updateService.ts) · `update.check`
- CI: [`.github/workflows/release.yml`](../.github/workflows/release.yml) (`tauri-action`, `includeUpdaterJson`)
- 가이드: [`docs/release.md`](./release.md) · `.env.example` 시크릿 슬롯
- `plugins.updater.pubkey`는 `tauri signer generate` 후 `tauri.conf.json`에 붙여 넣기 (플레이스홀더 `REPLACE_AFTER_tauri_signer_generate`)

### 요청 문구 예

> Tauri updater와 GitHub Releases 배포를 붙여줘. Check for Updates가 동작하게 하고, 서명·notarize는 가이드와 CI 시크릿 슬롯까지.

---

## 9-D. 테스트 골격 · CI (lint/build)

**상태:** 미구현

**의존성:** 없음 (9-B/C와 병행 가능)

### 범위

- Vitest(또는 팀 선택) — 순수 TS 유틸·프로토콜·가드 등 **빠른 단위 테스트**부터
- jdbc-agent — Gradle 스모크(빌드 성공) 또는 최소 junit
- GitHub Actions: `pnpm install` → agent build → `tsc` / vite build → (옵션) clippy/fmt
- PR에서 실패가 보이도록 required check 후보 정리

### 완료 기준

- PR에 lint/typecheck/build(및 소수 단위 테스트) CI가 돈다
- 로컬에서 `pnpm test`(또는 동등 스크립트)로 단위 테스트를 돌릴 수 있음

### 요청 문구 예

> 단위 테스트 골격과 GitHub Actions CI를 넣어줘. install → jdbc-agent build → tsc/vite, 핵심 유틸 Vitest부터.

---

## 9-E. e2e(선택) · 플랫폼 매트릭스

**상태:** 미구현

**의존성:** **9-D**

### 범위

- Playwright 또는 Tauri WebDriver — **소수 스모크** (메인 윈도우 · Settings 오픈 수준)
- CI 매트릭스: **macOS + Windows** (Linux 후순위)
- flaky 최소화 — DB/JDBC 실연결은 모킹 또는 수동 체크리스트로 분리

### 완료 기준

- CI에서 Mac·Win 중 최소 하나로 e2e 스모크가 통과하거나, 문서화된 수동 스모크 체크리스트가 있음

### 요청 문구 예

> e2e 스모크와 macOS/Windows CI 매트릭스를 최소로 넣어줘. 메인 윈도우·Settings 오픈 정도면 돼.

---

## 9-F. Help · 단축키 · 접근성 · 사용자 문서

**상태:** 미구현

**의존성:** 9-A About와 겹치면 A 완료 후. 키바인딩 레지스트리(기존)

### 범위

- Keyboard Shortcuts 뷰 — **읽기 + 검색** 최소 (편집기는 선택)
- Command Palette 최소 골격 (스텁 해소)
- 접근성 패스 — 주요 패널 포커스·`aria-*`·라이브 리전 정책 (전수 감사 아님)
- 사용자 문서 1종 — 설치·업데이트·단축키·진단(Copy diagnostics)  
  - 예: `docs/user-guide.md` 또는 `docs/install.md`
- Help 메뉴 항목을 실제 커맨드에 연결

### 완료 기준

- Help/Manage 스텁이 실제 UI·문서로 연결됨
- 단축키를 앱에서 검색할 수 있고, 설치·사용 문서가 repo에 있음

### 요청 문구 예

> Help·단축키 UI·접근성 최소 패스와 사용자 설치/단축키 문서를 추가해줘. Command Palette와 Keyboard Shortcuts 스텁을 살려줘.

---

## 같이 넣지 말 것


| 항목 | 귀속 |
|------|------|
| AI 감사·비용·세션 UI | **8-F** ([`ai-assistant-work-breakdown.md`](./ai-assistant-work-breakdown.md)) |
| PL/SQL AI 수정 루프 | **7-F** ([`plsql-work-breakdown.md`](./plsql-work-breakdown.md)) |
| 탐색기·그리드·SQL 편집 기능 | **4·5·6번** |
| Git / Flyway / Liquibase | **별도** (또는 9 이후) |
| 서버 프록시 · 벤더 대납 키 | AI v1 비범위 |
| Linux 1차 배포 · 원격 크래시 SaaS 필수 | v1 비범위 |

기능 로드맵(1~8)과 제품화(9)를 한 요청에 섞지 않는다.

---

## 로드맵 한 줄 문구의 매핑


| 로드맵 문구 | 주로 담당 |
|-------------|-----------|
| 오류/로그/진단 | **9-A** |
| 번들 JRE | **9-B** |
| 자동 업데이트·배포 | **9-C** (+ **9-B** 산출물) |
| 테스트·CI | **9-D** · **9-E** |
| 접근성·단축키·문서화 | **9-F** |

**9-B + 9-C**까지 되면 “설치해서 쓸 수 있는 제품”에 가깝다.  
**9-D~9-F**는 품질·운영·온보딩을 보강한다.

---

## 재사용할 기존 코드 (참고)


| 영역 | 경로·패턴 |
|------|-----------|
| 오류 메시지 | `formatErrorMessage` / `reportError`, AI/쿼리/연결 화면별 표시 |
| Help · 진단 | `helpActions.contribution.ts`, `services/diagnostics/*`, About/AppToast |
| Updates | `update.check` · [`updateService.ts`](../packages/silk-workbench/src/services/updates/updateService.ts) · [`docs/release.md`](./release.md) |
| 키바인딩 | `platform/keybinding`, 메뉴 `accelerator` |
| Agent 런치 | `crates/silk-db-agent-client`, `runtime_paths.rs`, `scripts/prepare-runtime-resources.mjs` |
| Agent 빌드 | `packages/jdbc-agent` (`gradlew`, `THIRD_PARTY_NOTICES.md`) |
| 번들 런타임 | `docs/bundled-runtime.md`, `src-tauri/resources/{jdbc-agent,jre}` |
| Tauri 번들 | `apps/silk-db-studio/src-tauri/tauri.conf.json` |
| 로컬 링 버퍼 패턴 | `AiAuditLogService`, `QueryHistoryService` (메타만 저장 참고) |

---

## 다음 단계

**9-A · 9-B · 9-C** 완료. 다음은 **9-D**(테스트·CI lint/build) 또는 **9-F**(Help·단축키·문서) 권장.  
Updater pubkey·`TAURI_SIGNING_PRIVATE_KEY`는 [`docs/release.md`](./release.md)에 따라 한 번 설정해야 릴리스/업데이트가 성립한다.
