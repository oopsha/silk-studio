# PL/SQL 객체 개발 — 작업 배분

로드맵 7번 항목을 한 번에 처리하기엔 범위가 크므로, **요청 5~6번**으로 나눈다.  
각 요청은 한 채팅에서 end-to-end로 끝낼 수 있는 단위다.  
(형식은 [`explorer-work-breakdown.md`](./explorer-work-breakdown.md)와 동일)

## 현재 상태 (기준)

- Monaco **`plsql`** 언어 등록 (`registerSqlLanguages`, Oracle 연결 시 dialect)
- 탐색기 **6-B** — `connection.ddl` + 읽기 전용 `DdlEditorView` (`silk://ddl/...`)
- **7-A** — `PlsqlEditorView` (`silk://plsql/...`), Oracle procedure/function/package 편집 탭·dirty
- **7-B** — Save / `Ctrl+S` → CREATE OR REPLACE 미리보기·확인 → `executeWriteStatement` + 스키마 트리 갱신
- **7-C** — Compile / `Ctrl+Shift+F9` → `connection.compile` + ALL_ERRORS → Monaco 마커·오류 목록
- **7-D** — 로컬 스냅샷(localStorage) · Monaco Diff · 롤백 · DB Reload
- **7-E** — package SPEC/BODY 탭 분리 · 저장 전 DB 소스 Diff
- 탐색기 **6-A~6-E** — procedure / function / package 목록·View DDL·Edit·Open Data·DROP/Rename
- 실행·쓰기 — `QueryExecutionService.executeWriteStatement`, `sqlGuard` read-only 가드
- 확인 다이얼로그 패턴 — `ExplorerObjectMutationDialog`, `QueryResultUpdateDialog`, `PlsqlSaveDialog`
- **미구현**: AI 수정 루프

### v1 대상 DB·객체

- **1차**: **Oracle** — procedure, function, package (spec/body 구분은 단계적으로)
- **2차(선택)**: PostgreSQL function/procedure (`pg_get_functiondef` 기반 편집·저장)
- v1에서 **넣지 말 것**: trigger 전용 UI, SQL Server T-SQL 모듈 편집기, 패키지 의존성 그래프

---

## 7-A. 객체 소스 열기·편집 탭

**상태:** 완료

**의존성:** 6-B (`connection.ddl`), 6-A (탐색기 진입). **agent 신규 API 불필요** (DDL fetch 재사용)

### 범위

- 탐색기 procedure / function / package → **Edit** (또는 View DDL과 구분된 **Open Source**)
  - Oracle 연결·해당 kind만 v1 활성
- 전용 에디터 탭 (`silk://plsql/...` 또는 `silk://source/...`)
  - Monaco `plsql`, **편집 가능**, dirty 표시
  - 탭 제목: `schema.name` (kind 아이콘/부제 선택)
  - `EditorService` + `silk-editor` 패턴 (DDL 읽기 전용 탭과 URI·렌더 분리)
- 소스 로드: `connection.ddl` (기존 bridge) — package는 spec/body 중 v1 하나만(본문 우선) 또는 탭 내 세그먼트
- 탭 닫기 시 dirty 확인 (VS Code 스타일)
- read-only 모드에서는 탭 **읽기 전용** 또는 Edit 메뉴 비활성

### 완료 기준

- 탐색기에서 PL/SQL 객체를 편집 탭으로 열고 내용을 수정할 수 있음
- DDL 보기 탭과 편집 탭이 혼동되지 않음 (라벨·read-only 구분)
- 연결·프로필·스키마·객체 식별이 탭 URI에 보존됨

### 요청 문구 예

> PL/SQL 객체를 탐색기에서 편집 탭으로 열어줘. connection.ddl로 소스를 불러오고 Monaco plsql 편집·dirty 표시를 넣어줘. Oracle procedure/function/package부터.

---

## 7-B. 저장 (CREATE OR REPLACE)

**상태:** 완료

**의존성:** 7-A (편집 탭). `query.execute` / `executeWriteStatement` 재사용

### 범위

- **Save** / `Ctrl+S` — 편집 탭 활성 시
- 저장 SQL 생성
  - v1: 버퍼 전체를 `CREATE OR REPLACE`로 감싸거나, DB에서 받은 소스가 이미 CR 형태면 그대로 실행 (드라이버 규칙 문서화)
  - 스키마·객체 이름·kind 메타데이터로 검증(이름 불일치 시 경고)
- **미리보기 + 확인** 다이얼로그 (6-E·5-E 패턴)
  - read-only·`sqlGuard` 이중 차단
- 성공 시: dirty 해제, (선택) 7-D 스냅샷 1건 기록 훅
- 실패 시: 에이전트/DB 오류 메시지 표시
- 성공 후: `ConnectionTreeService.invalidateAndRefreshSchema` (해당 스키마)

### 완료 기준

- 확인 없이 저장 SQL이 실행되지 않음
- read-only에서 저장 차단
- Oracle에서 procedure 또는 function 1종 이상 end-to-end 저장 검증

### 요청 문구 예

> PL/SQL 편집 탭에 저장을 넣어줘. CREATE OR REPLACE 미리보기·확인 후에만 실행하고 read-only는 막아줘. 성공하면 스키마 트리를 갱신해줘.

---

## 7-C. 컴파일 + 오류 표시

**상태:** 완료

**의존성:** 7-A. **agent·프로토콜 신규 API 필수**

### 범위

- `packages/db-protocol` + jdbc-agent: `connection.compile` (이름 가칭)
  - params: `schema`, `name`, `kind`, (선택) `packageBody` boolean
  - 동작: Oracle `ALTER … COMPILE` (package spec/body, procedure, function)
  - result: `success: boolean`, `errors: Array<{ line, column, message, type? }>` (`ALL_ERRORS` / `USER_ERRORS`)
- Tauri·브릿지·타입 가드 end-to-end
- 앱 UI
  - 툴바/메뉴 **Compile** (`Ctrl+Shift+F9` 등 — 키는 구현 시 코드와 맞출 것)
  - 오류 목록 패널 또는 Problems 스타일 목록
  - Monaco **마커** (`sqlErrorMarkers` 패턴 재사용·확장) — line/column 매핑
  - invalid 객체 상태는 7-A 탭 배너 또는 탐색기 아이콘(선택·후순위)
- 저장(7-B) 후 자동 컴파일은 **설정 옵션**으로 (기본 off 권장)

### 완료 기준

- 컴파일 실패 시 오류가 목록·에디터에 표시됨
- 컴파일 성공 시 오류 마커가 제거됨
- Oracle package 또는 procedure 1종 이상 검증

### 요청 문구 예

> PL/SQL 컴파일을 구현해줘. agent에 connection.compile을 추가하고 ALL_ERRORS를 파싱해 에디터 마커와 오류 목록에 표시해줘. Oracle부터.

---

## 7-D. 로컬 스냅샷 · diff · 롤백

**상태:** 완료

**의존성:** 7-A·7-B 권장 (저장 시점 스냅샷). **DB/agent 신규 API 없음** (로컬 저장)

### 범위

- 객체 키(`profileId` + schema + kind + name)별 **로컬 이력**
  - 저장 성공 시·수동 “스냅샷” 시 텍스트 보관 (상한 N건, 설정 또는 고정 20)
  - 저장소: `localStorage` 또는 Tauri fs (용량·개인정보 정책에 맞게 선택)
- **Diff** — 현재 버퍼 vs 선택 스냅샷 (Monaco diff editor 또는 간단한 side-by-side)
- **Rollback** — 스냅샷 내용을 버퍼에 복원 (dirty) + 확인 다이얼로그
- “DB에서 다시 불러오기” — `connection.ddl` 재 fetch로 discard 확인
- v1에서 **넣지 말 것**: Git 연동, 다른 스키마로 배포, 서버 측 버전 테이블

### 완료 기준

- 저장 이력에서 diff를 볼 수 있음
- 롤백 후 편집·다시 저장 가능
- 스냅샷이 프로필/객체별로 섞이지 않음

### 요청 문구 예

> PL/SQL 편집에 로컬 스냅샷과 diff·롤백을 넣어줘. 저장 성공 시 이력을 쌓고 Monaco diff로 비교·복원할 수 있게 해줘.

---

## 7-E. 배포 UX 정리 (선택)

**상태:** 완료

**의존성:** 7-B (실제 DB 반영은 저장과 동일). 탐색기·설정과 정리만

### 범위

- 용어·메뉴 정리: **Save to Database** vs **Deploy** (v1은 동일 파이프라인이어도 됨)
- (선택) 저장 전 **현재 DB 소스와 diff** (7-D + ddl fetch)
- (선택) package spec/body **탭 분리** 또는 하위 탭
- 탐색기 invalid 표시·“Recompile all invalid in schema” — **후순위**

### 완료 기준

- 사용자가 “저장 = DB 배포” 흐름을 한 경로로 이해할 수 있음
- package spec/body가 v1 최소 수준으로 열리고 저장됨 (범위는 구현 시 명시)

### 요청 문구 예

> PL/SQL package spec/body를 편집 탭에서 구분해 열고, 저장 전 DB 소스와 diff를 보여줘.

---

## 7-F. AI 수정 루프

**상태:** 미구현 — **로드맵 8번 이후** ([`ai-assistant-work-breakdown.md`](./ai-assistant-work-breakdown.md))

**의존성:** 7-A~7-C, **8. AI 어시스턴트** (컨텍스트·실행 권한·감사)

### 범위

- 컴파일 오류·선택 소스를 AI 컨텍스트로 전달
- 제안 패치 → diff 미리보기 → 사용자 승인 → 버퍼 반영 → (선택) 저장·컴파일
- `ai.allowExecute`·read-only와 충돌 없이 **제안만** vs **적용** 분리
- 비용·감사 로그는 8번 범위

### 완료 기준

- 컴파일 오류에서 “AI로 수정 제안” 한 사이클이 동작
- 승인 없이 AI가 DB에 쓰지 않음

### 요청 문구 예

> PL/SQL 컴파일 오류를 AI에 넘겨 수정안을 받고, diff 확인 후에만 에디터에 적용해줘. (8번 AI 기반 구현 후)

---

## 진행 순서

```
7-A 객체 소스 열기·편집 탭
 → 7-B 저장 (CREATE OR REPLACE)
 → 7-C 컴파일 + 오류 표시
 → 7-D 로컬 스냅샷 · diff · 롤백
 → 7-E 배포 UX / package spec·body (선택)
 → 7-F AI 수정 루프 (8번 이후)
```

- **7-A만** 또는 **7-A + 7-B**까지가 한 채팅 상한에 가깝다.
- **7-C**부터 agent·Oracle 전용 로직이 커지므로 **단독 요청** 권장.
- **7-D**는 UI·저장 모델이 따로 필요 — B 이후 착수.
- **7-F**는 8번과 같이 설계하지 않으면 범위가 다시 커진다.

---

## 같이 넣지 말 것

| 항목 |归属 |
|------|------|
| 탐색기 DROP/Rename·Open Data | **6번** (완료) |
| 일반 SQL 쿼리 편집·PL/SQL 문장 분리 | **4번** |
| AI 자연어→SQL·BYOK·감사 | **8번** |
| Git / Flyway / Liquibase 연동 | **9번 또는 별도** |
| 비-Oracle DB의 “PL/SQL” 명목 기능 | 7-B 이후 **선택** 단계 |

탐색기·PL/SQL·AI를 한 요청에 섞지 않는다 ([`explorer-work-breakdown.md`](./explorer-work-breakdown.md) 참고).

---

## agent / 프로토콜 체크리스트

| API | 용도 | 단계 |
|-----|------|------|
| `connection.ddl` | 소스 로드 | ✅ 있음 (6-B) |
| `query.execute` | CREATE OR REPLACE 저장 | ✅ 있음 |
| `connection.compile` | 컴파일 + 오류 목록 | ✅ 있음 (7-C) |
| `connection.metadata` | invalid 상태(선택) | 7-E·후순위 |

규칙: **프로토콜 → jdbc-agent → Tauri → 앱** 순으로 추가.

---

## 재사용할 기존 코드 (참고)

| 영역 | 경로·패턴 |
|------|-----------|
| DDL 읽기 탭 | `DdlEditorView`, `ddlEditorService`, `connectionDdlBridge` |
| 편집 탭·dirty | `EditorService`, `silk-editor` |
| 쓰기 실행 | `QueryExecutionService.executeWriteStatement` |
| read-only | `sqlGuard`, `database.readOnly` |
| 확인 다이얼로그 | `ExplorerObjectMutationDialog`, `QueryResultUpdateDialog`, `PlsqlSaveDialog` |
| PL/SQL 저장 | `plsqlSaveService`, `plsqlSaveSql`, `plsqlSave.contribution` (`silk.file.save` 가로채기) |
| 오류 마커 | `sqlErrorMarkers`, `plsqlCompileMarkers` |
| PL/SQL 컴파일 | `plsqlCompileService`, `connection.compile`, `silk.plsql.compile` |
| PL/SQL 스냅샷 | `plsqlSnapshotService`, `plsqlSnapshotStorage`, `PlsqlSnapshotDialog` |
| 트리 갱신 | `ConnectionTreeService.invalidateAndRefreshSchema` |
| 탐색기 메뉴 | `explorerObjectActions`, `explorerObjectActions.contribution` |

---

## 다음 단계

Agent 모드에서 **7-F**(AI 수정 루프, 8번 AI 이후)를 진행하면 된다.  
(6번 탐색기·7-A~7-E는 완료)
