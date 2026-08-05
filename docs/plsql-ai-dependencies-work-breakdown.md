# PL/SQL · 객체 의존성 + AI 분석 — 작업 배분

패키지/프로시저/함수 등 **DB에 존재하는** 객체를 AI가 소스·참조 메타와 함께 분석할 수 있게 한다.  
형식은 [`ai-assistant-work-breakdown.md`](./ai-assistant-work-breakdown.md) · [`plsql-work-breakdown.md`](./plsql-work-breakdown.md)와 동일.

## 현재 상태 (기준)

- Oracle PL/SQL 소스 열기·편집 — `connection.ddl` (`DBMS_METADATA.GET_DDL`), SPEC/BODY 분리 (7-A~7-E)
- 테이블/뷰 컬럼 — `connection.columns` (JDBC `DatabaseMetaData` 등, dialect별)
- AI Chat — 멀티턴·스트리밍·BYOK (8-A~8-B)
- AI 컨텍스트 — 스키마 요약(Explorer 캐시)·에디터 선택·쿼리 히스토리 (`aiContextService`, 8-C). **객체 의존성 없음**
- AI Provider — Gemini / OpenAI / Anthropic / Custom. **tool/function calling 없음**
- **미구현**: `connection.dependencies`, PL/SQL deps 컨텍스트 주입, AI 툴 루프
- 관련 out-of-scope (기존 문서): v1 “패키지 의존성 그래프” UI, 멀티에이전트 오케스트레이션

### 제품 의도

| 단계 | 사용자 체감 |
|------|-------------|
| **A + B** | **열린** PL/SQL 탭(상한 있음)의 소스 + 참조 객체 목록(+ 컬럼 요약)을 AI 컨텍스트에 넣어, 활성 탭을 바꿔도 분석에 활용한다 |
| **+ D** | 채팅만으로 `PKG_XXX 분석해줘` → 이어서 `AAA 테이블은 언제 사용해?` 같은 다턴이 가능하다 |

### 명시적 한계

- **미저장·미컴파일·신규 버퍼만 있는 객체**: Oracle 사전에 deps가 없음. 에디터 소스 문자열만으로의 “코드만 분석”은 A/B/D 범위 밖(필요 시 후속). Cursor가 저장 안 된 파일을 인덱싱 못 하는 것과 같음.
- **dirty 버퍼 vs DB**: deps는 **DB에 저장된 객체** 기준. 로컬만 추가한 참조는 사전에 안 잡힐 수 있음.
- **동적 SQL** (`EXECUTE IMMEDIATE` 등): `ALL_DEPENDENCIES`에 안 나올 수 있음 → 응답에 한계 고지.
- **역의존** (“DB 전체에서 AAA를 누가 쓰나”): D의 기본 `list_deps`(객체→참조)만으로는 부족. **D-R**은 선택/후속.

### v1 방언

- **A**: 공통 프로토콜 + **Oracle 1차**. 기타 dialect는 default 빈 목록 / not supported → 후속 요청으로 확장.
- 패키지·프로시저·함수 분석 시나리오는 Oracle 1차와 동일.

---

## 진행 순서

```
A  connection.dependencies (공통 + Oracle)
 → B  AI 컨텍스트 주입 (열린 PL/SQL 탭, 상한 있음)
 → D  AI 툴 루프 (채팅에서 객체 지정·다턴 추가 조회)
 → (선택) D-R 역의존 list_dependents
 → (선택) 기타 dialect 채우기
```

- **A만** 또는 **A + B**를 한 채팅 상한으로 권장.
- **D**는 Provider 툴 지원이 들어가므로 **단독 요청** 권장.
- 7-F(컴파일 오류 → 수정 루프)와 섞지 않는다. 본 문서는 **읽기·분석** 중심.

---

## A. `connection.dependencies` (공통 + Oracle)

**상태:** 완료

**의존성:** 기존 jdbc-agent · `db-protocol` · Tauri bridge 패턴 (`connection.ddl`과 동일 계열)

### 범위

- 프로토콜: `connection.dependencies`
  - 요청 예: `connectionId`, `schema`, `name`, `kind` (`package` | `procedure` | `function` | …), `packageBody?`
  - 응답 예: `dependencies[]` — `schema`, `name`, `type` (`TABLE` | `VIEW` | `PACKAGE` | …), (선택) `dependencyType`
- `DbDialect`에 메서드 시그니처 추가. **값 채우기만 dialect별**
- **Oracle**: `ALL_DEPENDENCIES` (SPEC/BODY는 `TYPE` / `packageBody`로 필터)
- 기타 dialect: default **빈 배열** 또는 명확한 unsupported (앱이 깨지지 않게)
- Tauri command · Rust client · 프론트 bridge (`connectionDependenciesBridge` 등)
- (선택) 단위 테스트 / agent 수동 검증 메모

### 완료 기준

- Oracle 연결에서 패키지/프로시저/함수에 대해 참조 목록이 JSON으로 온다
- 비-Oracle은 빈 목록(또는 합의된 에러)으로 안전히 실패하지 않는다
- Silk 앱이 bridge로 호출 가능하다 (UI 없어도 됨)

### 요청 문구 예

> `connection.dependencies` 프로토콜과 bridge를 추가하고, OracleDialect만 ALL_DEPENDENCIES로 구현해줘. 다른 방언은 빈 목록 default.

### 기대효과

앱이 “이 객체가 컴파일 시점에 무엇을 참조하는지”를 DB에서 가져올 수 있다. (AI 없어도 성립하는 기반)

---

## B. AI 컨텍스트 주입 (열린 PL/SQL 탭, 상한 있음)

**상태:** 완료

**의존성:** **A**, 기존 `aiContextService` / `AiContextHost` / `configureAiContextHost`, `EditorService.getTabs()` · `parsePlsqlEditorUri`

### 범위

- 채팅 요청 전, **열린** PL/SQL 객체 탭(`silk://plsql/...`)을 `EditorService.getTabs()`로 수집해 각 탭마다:
  1. 소스 (`tab.content`; 활성 탭은 Monaco 스냅샷과 정합 가능)
  2. **A**로 deps 조회 (`parsePlsqlEditorUri` → schema/name/kind/packageBody)
  3. 참조 TABLE/VIEW에 대해 `connection.columns` 요약 (상한)
- **상한·필터 (v1 권장)**
  - PL/SQL 탭만 (`isPlsqlEditorTab`)
  - 최대 N개 탭 (예: 5), 탭당 소스·deps·컬럼 truncate
  - (선택) 현재 AI 컨텍스트 연결과 같은 `profileId`만
  - 활성 탭은 프롬프트에 `(active)` 등으로 표시만 (내용은 비활성 탭도 포함)
- 시스템 프롬프트 블록 예: Open PL/SQL objects / per-object Dependencies / Referenced columns
- 프롬프트에 “아래 deps·columns는 DB에서 가져온 사실이다. 없는 참조를 지어내지 마라” 명시
- 토큰 상한·truncate (기존 `LIMITS` 패턴 연장)
- Settings: `ai.context.includePlsqlDeps` (권장, 기본 on; 열린 PL/SQL 탭이 있을 때만 의미)
- **8-C `includeSelection`과 분리**: 활성 에디터 선택/버퍼는 기존대로; 본 블록은 **열린 PL/SQL 탭 집합** 전용

### 완료 기준

- Oracle 패키지 SPEC·BODY 등 **여러 PL/SQL 탭을 동시에 연 상태**에서 AI에게 물으면, 요청 페이로드에 각 탭의 deps·컬럼 요약이 포함된다 (활성 탭이 아니어도 됨)
- 열린 PL/SQL 탭이 없으면 본 블록은 생략되고, 기존 8-C 동작과 동일
- 플래그 off 시 본 블록 생략
- 탭·객체 수 상한으로 메타데이터 폭주 시 요청이 상시 실패하지 않는다

### 요청 문구 예

> 열린 PL/SQL 탭(상한 N)마다 connection.dependencies와 columns를 AI 시스템 프롬프트에 주입해줘. 활성 탭만이 아니라 getTabs 기준. Settings 플래그와 truncate 포함.

### 기대효과

열린(DB에서 로드한) 패키지·프로시저·함수에 대해 AI가 추측/파싱이 아니라 **사전 의존성 + 컬럼 메타**를 보고 설명한다. SPEC+BODY를 같이 열어 둔 경우 한 번에 맥락을 줄 수 있다.

---

## D. AI 툴 루프

**상태:** 완료

**의존성:** **A**, (권장) **B**, 8-A Provider 클라이언트

### 범위

- Provider 클라이언트에 **tools / tool_calls** (또는 각사 동등 API) 스트리밍·루프 지원
  - Gemini / OpenAI / Anthropic / Custom(OpenAI-compatible) — v1에서 지원 가능한 provider부터, 미지원은 안내
- `AiChatService`: model → tool call → 로컬 실행 → 결과 재주입 → 최종 답 (취소·감사 로그 유지)
- **읽기 전용 툴만** (쓰기는 기존 8-D/8-E·승인 UI와 분리)

| Tool (가칭) | 구현 |
|-------------|------|
| `get_plsql_source` | `connection.ddl` |
| `list_object_dependencies` | `connection.dependencies` (**A**) |
| `get_table_columns` | `connection.columns` |
| (선택) `get_object_ddl` | 테이블/뷰 DDL 요약용 `connection.ddl` |

- 채팅 UI: “툴 사용 중…” 정도 (과한 agent UI 금지)
- 시스템 프롬프트: 분석 시 툴로 사실을 확인하라는 지침
- **자동 DB 쓰기·컴파일 금지**

### 완료 기준

- 에디터에 해당 탭이 없어도 `PKG_XXX 분석해줘` → 툴로 소스·deps를 가져와 분석 응답
- 이어서 `AAA 테이블은 언제 사용해?` → **해당 패키지 소스/맥락 기준**으로 사용 위치를 설명할 수 있다
- 승인 없이 AI가 DB에 쓰지 않는다

### 요청 문구 예

> AI Chat에 읽기 전용 툴 루프를 넣어줘. get_plsql_source / list_object_dependencies / get_table_columns로 채팅에서 패키지 분석·다턴 추적이 되게.

### 기대효과

활성 탭에 묶이지 않은 **채팅 주도 분석**과, 분석 후 테이블 사용처를 묻는 **다턴**이 가능하다.

---

## (선택) D-R. 역의존 `list_dependents`

**상태:** 후속

**의존성:** A와 유사 API, D 툴 등록

### 범위

- `connection.dependents` 또는 deps API의 방향 플래그: “AAA를 참조하는 객체들”
- Oracle: `ALL_DEPENDENCIES`에서 `REFERENCED_*` 조건
- 툴: `list_object_dependents`

### 완료 기준

- `DB 전체에서 AAA 테이블은 누가 쓰나`에 툴로 답할 수 있다

### 기대효과

패키지 내부 사용처(D)를 넘어 **전사 사용처** 질문까지 가능.

---

## (선택) A-확장. 기타 dialect

**의존성:** A

- PostgreSQL / SQL Server / MySQL 등 카탈로그·`pg_depend` 등으로 같은 응답 구조 채우기
- 패키지 개념이 없는 DB는 procedure/function/view 등 지원 kind만

---

## 같이 넣지 말 것

| 항목 | 归属 |
|------|------|
| 컴파일 오류 → AI 수정 → Diff 적용 | **7-F** ([`plsql-work-breakdown.md`](./plsql-work-breakdown.md)) |
| 자연어→SQL 검수·실행 | **8-D / 8-E** (기존) |
| Explorer 의존성 그래프 UI | 별도 / 기존 v1 out-of-scope |
| 미저장 버퍼 AST 파싱으로 deps 추론 | 후속 (명시적 한계) |
| 서버 프록시·우리 측 API 키 | 8번과 동일 금지 |
| 멀티에이전트 오케스트레이션 | 금지 — **단일 채팅 + 로컬 DB 툴** |

---

## agent / 프로토콜 체크리스트

| API / 능력 | 용도 | 단계 |
|------------|------|------|
| `connection.ddl` | 소스 | ✅ 있음 |
| `connection.columns` | 참조 테이블 메타 | ✅ 있음 |
| `connection.dependencies` | 객체→참조 | **A** ✅ |
| `connection.dependents` (선택) | 참조←객체 | **D-R** |
| AI system prompt PL/SQL 블록 | 열린 PL/SQL 탭 분석 (상한) | **B** ✅ |
| Provider tool calling + Chat 루프 | 채팅 지정·다턴 | **D** ✅ |

규칙: **프로토콜 → jdbc-agent → Tauri → 앱** 순으로 추가. 방언은 **공통 구조에 값만** 다르게.

---

## 재사용할 기존 코드 (참고)

| 영역 | 경로·패턴 |
|------|-----------|
| DDL / dialect | `OracleDialect.fetchObjectDdl`, `DbDialect` |
| columns | `collectTableColumns`, `connection.columns` |
| PL/SQL 탭 | `plsqlEditorService`, `PlsqlEditorView`, `plsqlEditorUri`, `parsePlsqlEditorUri`, `EditorService.getTabs()` |
| AI 컨텍스트 | `aiContextService`, `aiContextHost`, `configureAiContextHost` |
| AI 채팅 | `aiChatService`, `aiProviderService`, provider clients |
| 프로토콜 | `packages/db-protocol` |

---

## 다음 단계

Agent 모드에서 **A (공통 + Oracle)** → **B** → **D** 순으로 진행한다.  
방언 확장·역의존(D-R)은 A/B/D 검증 후 별도 요청.
