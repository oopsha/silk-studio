# SQL IntelliSense — 작업 배분

로드맵 4번의 자동완성을 **완성도 높은 IntelliSense** 수준으로 끌어올리기 위한 배분이다.  
기존 [`sql-editing-work-breakdown.md`](./sql-editing-work-breakdown.md) **4-C**는 1차(키워드·스키마·`.` 컬럼)까지 완료한 상태다.  
본 문서는 그 **다음 단계**를 **요청 6번**으로 나눈다.  
각 요청은 한 채팅에서 end-to-end로 끝낼 수 있는 단위다.  
(형식은 [`productization-work-breakdown.md`](./productization-work-breakdown.md) · [`plsql-work-breakdown.md`](./plsql-work-breakdown.md)와 동일)

## 현재 상태 (기준)

- Monaco CompletionProvider — [`registerSqlCompletion.ts`](../apps/silk-db-studio/src/services/sql/registerSqlCompletion.ts)
- 컨텍스트 — 줄 prefix의 `.` qualifier만 ([`sqlCompletionContext.ts`](../apps/silk-db-studio/src/services/sql/sqlCompletionContext.ts))
- 후보 — 절·별칭·CTE·방언 함수·정렬/캐시 · 픽스처/문서(I-F)
- 트리거 — `.` · `(` / `,`(시그니처) · `Ctrl+Space` / 타이핑(Monaco). 공백 트리거 제거
- **약점**: 재귀 CTE self-ref · 깊은 중첩/UNION 컬럼 추론은 휴리스틱 · 함수 카탈로그는 자주 쓰는 항목 위주 · Settings UI(“suggest on type”)는 미구현(공백 트리거 제거로 대체)

### “완성도 높은 IntelliSense” 목표 (제품 한 줄)

> 커서 **위치·절·스코프**에 맞는 후보만 제안하고, 스키마 객체·별칭·컬럼·함수가 VS Code급으로 **빠르고 예측 가능하게** 동작한다.

### v1 범위 / 비범위

| 넣음 | 넣지 않음 (이후) |
|------|------------------|
| SELECT/DML 절 인식 · 키워드/함수 분리 | 전체 SQL 파서·언어 서버(LSP) 필수화 |
| FROM/JOIN 별칭 → 컬럼 | 실행 계획 기반 추천 · AI 완성과 혼재 |
| CTE·1단 서브쿼리 스코프 | 프로시저 본문 PL/SQL 전용 IntelliSense(→ 7번) |
| 방언별 함수·snippet 최소 | 원격 스키마 실시간 인덱싱 SaaS |
| Suggest 성능·캐시·정렬 | 전 방언 문법 전수 커버 |

---

## 진행 순서

```
I-A  절(clause) 인식 + 키워드/함수 분리 + 문맥 필터
 → I-B  FROM/JOIN 별칭 · 테이블 스코프 → 컬럼
 → I-C  CTE · 서브쿼리 스코프
 → I-D  방언별 함수·내장 · snippet · 시그니처 힌트
 → I-E  성능 · 캐시 · 정렬 · UX (트리거·필터·상세)
 → I-F  회귀 테스트 · 픽스처 · 문서 (선택적으로 E와 병행)
```

- **I-A**만으로 “빈 문서에 ABS” 문제가 해소된다 — **최우선**.
- **I-B**가 체감 IntelliSense의 핵심(실무 SELECT 작성).
- **I-C**는 B 위에 쌓는다. C 없이 B만으로도 대부분 쿼리는 이득.
- **I-D**는 방언 목록·snippet — A와 병행 가능하지만 A 완료 후가 안전.
- **I-E/F**는 품질·유지보수.

---

## I-A. 절 인식 · 키워드/함수 분리 · 문맥 필터

**상태:** 완료

**의존성:** 기존 4-C CompletionProvider

### 범위

- `COMMON_KEYWORDS` / `COMMON_FUNCTIONS` / 방언 extras를 **종류별로 분리** export
- 커서 앞 SQL(최소: 현재 문장 또는 줄+상위 N자)로 **절 추정** 휴리스틱  
  예: `statement_start` · `select_list` · `from` · `join` · `where` · `group_by` · `order_by` · `set` · `values` · `unknown`
- 절별 후보 정책  
  - `statement_start`: 문장 시작 키워드만 (`SELECT`/`WITH`/`INSERT`/…) — **함수 제외**
  - `from` / `join`: 스키마·테이블(+ 이후 I-B에서 별칭) — 함수·컬럼 우선순위↓ 또는 제외
  - `select_list` / `where` / `having`: 컬럼·함수·식 키워드 — `FROM`/`JOIN` 키워드 우선↓
- `buildSuggestions`가 절 정책만 조합하도록 리팩터
- 단위 테스트: 절 추정 + “빈 문서에 ABS 없음”

### 완료 기준

- 빈 에디터/`Ctrl+Space`에 `ABS`/`COUNT`가 **안** 나옴
- `SELECT ` 뒤에는 함수·컬럼 후보가 의미 있게 나옴
- `FROM ` 뒤에는 테이블/스키마가 우선

### 요청 문구 예

> SQL 자동완성을 절(clause) 인식하게 해줘. 키워드와 함수를 분리하고, 빈 에디터에는 문장 시작 키워드만, FROM 뒤에는 테이블, SELECT 식 자리에는 함수·컬럼이 나오게 해줘.

---

## I-B. FROM/JOIN 별칭 · 테이블 스코프 → 컬럼

**상태:** 완료

**의존성:** **I-A** (절 인식). 메타데이터 컬럼 API(기존 `connection.columns`)

### 범위

- 현재 문장의 `FROM` / `JOIN` … `AS? alias` 파싱 → `{ table, schema?, alias }[]`
- `alias.` / `table.` 에서 해당 관계의 컬럼 제안
- unqualified 컬럼(절이 select/where일 때): FROM에 올라온 테이블들의 컬럼 병합(이름 충돌 시 `table.col` detail)
- 스키마 한정자 `schema.table.` 기존 로직과 통합
- 별칭 대소문자·따옴표/`[]` 식별자 규칙 (방언 최소)

### 완료 기준

- `FROM emp e WHERE e.` → `emp` 컬럼
- `JOIN dept d ON e.` → 각각 올바른 테이블 컬럼
- 별칭 없는 `FROM emp WHERE ` → `emp` 컬럼 후보

### 요청 문구 예

> FROM/JOIN 별칭을 해석해서 alias. 및 WHERE/SELECT의 컬럼 자동완성이 해당 테이블에 맞게 나오게 해줘.

---

## I-C. CTE · 서브쿼리 스코프

**상태:** 완료

**의존성:** **I-B**

### 범위

- `WITH cte AS (…)` 이름·컬럼(명시 컬럼 리스트 또는 `SELECT` 목록 휴리스틱) 수집
- CTE를 FROM 후보·별칭 대상으로 포함
- 괄호 깊이로 **현재 서브쿼리 스코프**의 FROM만 사용 (바깥 테이블 누수 최소화)
-  Nested SELECT 1단 이상 권장, 과도한 파서는 피하고 휴리스틱 + 테스트로 고정

### 완료 기준

- `WITH c AS (SELECT id FROM t) SELECT * FROM c WHERE c.` → CTE 컬럼/`id`
- 서브쿼리 안 `FROM`과 바깥 `FROM`이 섞이지 않음(대표 케이스)

### 요청 문구 예

> WITH CTE와 서브쿼리 스코프를 자동완성에 반영해줘. CTE 이름·컬럼이 FROM/별칭 완성에 나오고, 중첩 SELECT에서는 안쪽 FROM만 쓰게 해줘.

---

## I-D. 방언별 함수 · snippet · 시그니처 힌트

**상태:** 완료

**의존성:** **I-A** (함수 목록 분리). I-B와 **병행 가능**

### 범위

- 드라이버별 함수 카탈로그 보강 (Oracle `NVL`/`TO_DATE`, T-SQL `GETDATE`/`ISNULL`, MySQL `IFNULL`/`DATE_FORMAT`, PG `COALESCE`/`date_trunc` 등 — **자주 쓰는 것부터**)
- CompletionItem `kind: Function`, `insertTextRules`로 `ABS($0)` 같은 snippet
- (선택) Monaco **signature help** provider — 최소 인자 힌트 1~2개 방언 공통 함수
- `detail`/`documentation`에 짧은 설명

### 완료 기준

- 식 자리에서 방언에 맞는 함수가 함수 kind로 보임
- 대표 함수는 `()`/`$0` snippet으로 삽입
- 시그니처는 넣었다면 `Ctrl+Shift+Space` 또는 `(` 트리거로 보임

### 요청 문구 예

> 방언별 SQL 함수 자동완성을 보강하고, 함수는 snippet으로 넣으며 가능하면 시그니처 힌트까지 최소로 붙여줘.

---

## I-E. 성능 · 캐시 · 정렬 · Suggest UX

**상태:** 완료

**의존성:** I-A~B 이후 (후보가 늘수록 필요)

### 범위

- 메타데이터/컬럼 캐시 TTL·연결 전환 시 무효화 점검 ([`sqlCompletionCatalog.ts`](../apps/silk-db-studio/src/services/sql/sqlCompletionCatalog.ts))
- `sortText` / `preselect` / `filterText`로 **절에 맞는 후보가 위로**
- 트리거 문자 재검토 (매 공백마다 과도한 팝업이면 축소)
- 대량 스키마에서 `ensureSchemaObjectsLoaded` 폭주 방지 (현재 스키마·FROM 테이블만)
- (선택) Settings: “SQL suggest on type” on/off

### 완료 기준

- 큰 스키마에서도 Suggest가 UI를 막지 않음
- 문맥상 유용한 항목이 목록 상단에 옴
- 연결 끊기/바꾸면 이전 DB 후보가 새지 않음

### 요청 문구 예

> SQL IntelliSense 성능·캐시·정렬을 다듬어줘. 절에 맞는 후보가 위에 오고, 큰 스키마에서도 렉 없이 Ctrl+Space/타이핑 제안이 뜨게 해줘.

---

## I-F. 회귀 테스트 · 픽스처 · 문서

**상태:** 완료

**의존성:** I-A 필수 · B/C 케이스 추가

### 범위

- 절 추정·별칭 파서·CTE 픽스처 단위 테스트 (Vitest)
- 대표 시나리오 표를 [`docs/user-guide.md`](./user-guide.md) 또는 본 문서 “수동 검증”에 추가
- (선택) Playwright는 Suggest DOM이 불안정하면 단위 테스트 우선

### 완료 기준

- I-A/B/C의 핵심 예시가 테스트로 고정됨
- 사용자/기여자가 “어디서 제안이 나와야 하는지” 문서를 볼 수 있음

### 산출물

| 종류 | 경로 |
|------|------|
| 픽스처 | [`sqlIntellisense.fixtures.ts`](../apps/silk-db-studio/src/services/sql/sqlIntellisense.fixtures.ts) |
| 회귀 테스트 | [`sqlIntellisense.fixtures.test.ts`](../apps/silk-db-studio/src/services/sql/sqlIntellisense.fixtures.test.ts) |
| 사용자 안내 | [`user-guide.md`](./user-guide.md) — **SQL IntelliSense** |
| 수동 검증 | 아래 섹션 |

### 요청 문구 예

> SQL IntelliSense 절·별칭·CTE 픽스처 단위 테스트와 간단한 검증 체크리스트를 추가해줘.

---

## 수동 검증 (기여자)

앱을 띄운 뒤 SQL 탭에서 확인한다. 자동화는 픽스처 테스트를 우선한다.

| # | 절차 | 기대 |
|---|------|------|
| 1 | 빈 에디터에서 `Ctrl+Space` | `SELECT`/`WITH` 등만, `ABS` 없음 |
| 2 | `SELECT ` 후 제안 | 함수·(FROM이 있으면) 컬럼 |
| 3 | `FROM ` 후 제안 | 테이블/스키마 우선 |
| 4 | `FROM emp e WHERE e.` | `emp` 컬럼 |
| 5 | `WITH c AS (SELECT id FROM t) SELECT * FROM c WHERE c.` | `id` |
| 6 | 중첩 서브쿼리 안쪽 `d.` | 안쪽 테이블만 |
| 7 | Oracle 연결 후 `TO_CH` | `TO_CHAR` snippet |
| 8 | 연결 전환 후 이전 DB 컬럼이 섞이지 않음 | 캐시 무효화 |

단위 테스트: `npm test -- apps/silk-db-studio/src/services/sql/`

---

## 같이 넣지 말 것


| 항목 | 귀속 |
|------|------|
| 문장 실행·포맷·히스토리 | **4-A/B/D** ([`sql-editing-work-breakdown.md`](./sql-editing-work-breakdown.md)) |
| PL/SQL 패키지 편집 IntelliSense | **7번** ([`plsql-work-breakdown.md`](./plsql-work-breakdown.md)) |
| AI가 SQL을 써 주는 것 | **8번** ([`ai-assistant-work-breakdown.md`](./ai-assistant-work-breakdown.md)) |
| 탐색기 트리·시스템 DB 표시 | **6번** / 연결 프로필 |
| 전용 SQL Language Server 도입 | 별도 검토 (본 배분은 Monaco provider 고도화) |

기능 로드맵 다른 번호와 IntelliSense를 한 요청에 섞지 않는다.

---

## 로드맵·기존 4-C와의 관계

| 문서 | 역할 |
|------|------|
| 로드맵 4 · 4-C | 1차 자동완성(키워드·객체·`.`) — **완료** |
| **본 문서 I-A~F** | 문맥·별칭·CTE·방언 함수·성능 — **완성도 높은 IntelliSense** |

---

## 재사용할 기존 코드 (참고)


| 영역 | 경로·패턴 |
|------|-----------|
| Provider | `registerSqlCompletion.ts` |
| `.` 파싱 | `sqlCompletionContext.ts` |
| 메타·컬럼 | `sqlCompletionCatalog.ts`, `connection.columns` |
| 키워드 목록 | `sqlKeywords.ts` |
| 방언 | `sqlDialect.ts`, `registerSqlLanguages.ts` |
| 탐색기 스키마 캐시 | `ConnectionTreeService`, `getExplorerSchemas` |

---

## 다음에 할 일

**I-A~F는 완료.** 이후 개선은 개별 이슈로 잡는다 (예: DB 메타데이터 기반 함수 목록, Settings UI, 재귀 CTE).

픽스처·회귀: `npm test -- apps/silk-db-studio/src/services/sql/`  
사용자 안내: [`user-guide.md`](./user-guide.md) · 수동 검증: 위 섹션.
