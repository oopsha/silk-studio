# DB 탐색기 — 작업 배분

로드맵 6번 항목을 한 번에 처리하기엔 범위가 크므로, **요청 5번**으로 나눈다.  
각 요청은 한 채팅에서 end-to-end로 끝낼 수 있는 단위다.  
(형식은 [`sql-editing-work-breakdown.md`](./sql-editing-work-breakdown.md)와 동일)

## 현재 상태 (기준)

- `ConnectionsExplorer` — 연결 프로필 트리, 연결/해제·편집·복제·삭제, 프로필 단위 **Refresh**
- `ConnectionTreeService` — 스키마 목록·스키마별 객체 그룹 lazy load, 연결별 캐시·invalidate
- Agent / 프로토콜: `connection.metadata`, `connection.columns`, `connection.primaryKeys`, `query.execute`
- 트리 구조: 프로필 → 스키마 → 그룹(Tables / Views / Procedures / …) → **객체 이름만** (클릭·메뉴·액션 없음)
- 미구현: DDL 보기, 테이블/뷰 데이터 보기, 객체 검색, 스키마/그룹 단위 새로고침, 객체 수정(DDL 실행)
- 관련 재사용: SQL 에디터(4), `QueryExecutionService` + 결과 그리드(5), read-only 가드(`sqlGuard`)

---

## 6-A. 트리 UX + 객체 액션 골격

**상태:** ✅ 완료

**의존성:** 없음 (가장 먼저). 기존 `ConnectionsExplorer`·`ConnectionTreeService` 위에 UX·커맨드만 얹으면 됨

### 범위

- VS Code / 코드 탐색기에 가까운 트리 UX
  - 객체 행 선택·포커스, Enter/더블클릭으로 기본 액션 (table/view → Open Data stub, 그 외 → View DDL stub)
  - 스키마·그룹 단위 **Refresh** (프로필 전체 refresh와 구분) — 그룹 refresh는 스키마 객체 재로드
  - 확장 상태는 세션 내 유지
- 컨텍스트 메뉴·더블클릭 **골격**
  - `silk.explorer.openData` / `viewDdl` / `copyName` / `refreshSchema` 커맨드
  - Open Data / View DDL 연동 완료 (6-B·6-C)
- 트리 **필터(클라이언트)**
  - 로드된 스키마/객체 이름 부분 일치 (대소문자 무시)
  - 연결 끊김·로딩·빈 그룹·Retry 메시지
- `ConnectionTreeService`
  - `invalidateSchema` / `refreshSchemaObjects`

### 완료 기준

- 스키마·그룹을 개별 새로고침할 수 있음 ✅
- 객체에 우클릭·더블클릭 시 kind에 맞는 메뉴/동작 진입점이 있음 ✅
- 로드된 트리에서 이름으로 빠르게 찾을 수 있음 ✅

### 요청 문구 예

> DB 탐색기 트리 UX를 다듬어줘. 스키마/그룹 refresh, 객체 컨텍스트 메뉴·더블클릭 골격, 로드된 트리 필터를 end-to-end로 넣어줘.

---

## 6-B. DDL 보기

**상태:** 완료

**의존성:** 6-A 권장 (객체에서 “View DDL” 진입). **agent·프로토콜 신규 API 필수**

### 범위

- `packages/db-protocol` + jdbc-agent: `connection.ddl` (또는 `connection.objectDefinition`)
  - params: `schema`, `name`, `kind` (`table` | `view` | `procedure` | `function` | `package` …)
  - result: `ddl: string` (또는 `source`), `dialectId`
- 드라이버별 추출 (1차 — 읽기 전용)
  - **Oracle**: `DBMS_METADATA.GET_DDL` / `GET_DEPENDENT_DDL` (패키지·프로시저)
  - **PostgreSQL**: `pg_get_viewdef`, `pg_get_functiondef` 등
  - **SQL Server**: `OBJECT_DEFINITION` / `sp_helptext` 계열
  - **MySQL/MariaDB**: `SHOW CREATE TABLE` / `SHOW CREATE VIEW`
- 앱: DDL 전용 **읽기 전용** 에디터 탭 (Monaco, `silk-editor` 패턴)
  - 탭 제목: `DDL — schema.object`
  - 복사·포맷(선택) 정도만 (실행·수정은 6-E)
- 탐색기에서 table/view/procedure/function/package → **View DDL** 연동

### 완료 기준

- 지원 kind에서 DDL이 탭에 표시됨 (드라이버별 1종 이상 검증)
- DDL 탭은 read-only이며 실행되지 않음
- agent/브릿지/Tauri 권한·타입 가드 end-to-end

### 요청 문구 예

> DB 탐색기에서 DDL 보기를 구현해줘. agent에 connection.ddl을 추가하고, 탐색기 객체에서 읽기 전용 DDL 탭을 열어줘. Oracle/PostgreSQL부터 맞추고 나머지 드라이버는 가능한 범위만.

---

## 6-C. 테이블·뷰 데이터 보기

**상태:** 완료

**의존성:** 6-A (Open Data 진입). **5번 결과 그리드·`QueryExecutionService` 재사용**

### 범위

- 탐색기 table/view → **Open Data** (더블클릭 기본 동작 후보)
  - 생성 SQL: `SELECT * FROM schema.object` (스키마 생략 시 세션/프로필 규칙 — 5-E PK 해석과 동일 패턴 재사용)
  - `QueryExecutionService.execute()` 또는 전용 `openTableData()`로 **결과 패널**에 표시
- 에디터 연동 (선택)
  - 동일 SQL을 새 쿼리 탭에 넣고 실행 (코드 스타일 “Script as SELECT”)
  - v1은 **패널 결과만**으로도 완료 가능
- maxRows·read-only·다중 탭(5-C)과 충돌 없이
- 뷰(view)는 SELECT만 — 안전 UPDATE(5-E)는 table만 해당한다고 UI에 명시

### 완료 기준

- 탐색기에서 테이블(뷰) 더블클릭 또는 메뉴로 데이터 그리드가 열림
- 연결·스키마·객체 이름이 SQL에 올바르게 반영됨
- 결과 그리드 기존 기능(정렬·필터·복사·CSV) 그대로 동작

### 요청 문구 예

> DB 탐색기에서 테이블/뷰 데이터 보기를 구현해줘. Open Data로 SELECT를 실행하고 결과 그리드에 띄워줘. QueryExecutionService와 기존 그리드를 재사용해줘.

---

## 6-D. 검색·새로고침 고도화

**상태:** 완료

**의존성:** 6-A (트리·캐시). 6-B/6-C와 병렬 가능하나 **6-A 이후** 권장

### 범위

- **검색 UX** (6-A 클라이언트 필터 확장)
  - Quick Pick 또는 탐색기 상단 검색: 스키마·객체 이름 매칭
  - 미로드 스키마는 “열어서 검색” 또는 백그라운드 `connection.metadata(schema)` (성능 주의)
  - 검색 결과에서 Enter → 6-C Open Data / 6-B View DDL로 점프
- **새로고침 정책**
  - 연결 성공 시 기본 스키마 자동 expand·preload (설정 옵션)
  - 객체 변경 후(6-E) 해당 스키마만 invalidate
- 로딩·에러·빈 상태 VS Code 톤 정리
- (선택) 탐색기 커맨드: `Refresh`, `Collapse All`

### 완료 기준

- 이름으로 객체를 찾아 데이터/DDL로 이동할 수 있음
- 대형 스키마에서도 검색·refresh가 예측 가능하게 동작
- 6-A보다 나은 “찾기” 경험 (필터만으로는 부족한 경우 해소)

### 요청 문구 예

> DB 탐색기 검색과 새로고침을 고도화해줘. Quick Pick 검색, 결과에서 데이터/DDL 열기, 스키마 단위 캐시 invalidate를 넣어줘.

---

## 6-E. 객체 수정 (DDL 실행)

**상태:** 완료 (v1 — DROP + Rename)

**의존성:** 6-B (DDL 생성·표시). read-only·확인 다이얼로그·5-E UPDATE 패턴 참고. **로드맵 7(PL/SQL)과 범위 겹침**

### 범위 (v1 — 최소)

- **DROP** (테이블/뷰 등) — 확인 다이얼로그 + 생성된 `DROP …` 미리보기 + 실행
- **Rename** — 드라이버별 지원 시만 (Oracle `RENAME`, PostgreSQL `ALTER … RENAME` …)
- read-only 모드·`sqlGuard` 차단
- 성공 후 해당 스키마 트리 invalidate + 6-D refresh 연동
- ~~v1에서 **넣지 말 것**: 컬럼 편집 UI, 복잡한 ALTER TABLE 빌더~~ → 구현 완료(아래 "테이블 구조 편집" 참고). 패키지 본문 편집은 계속 범위 밖(→ 7)

### 테이블 구조 편집 (컬럼 + 테이블명/코멘트) — 완료

Properties → Columns 탭에서 테이블명·테이블 코멘트·컬럼(추가/삭제/이름변경/타입/길이/스케일/Not Null/기본값/코멘트)을 직접 편집하고 저장 시 4개 방언(Oracle/PostgreSQL/MySQL·MariaDB/SQL Server) 각각의 ALTER TABLE류 문장을 생성해 확인 다이얼로그 → 실행하는 기능. 핵심 파일: `tableStructureDiff.ts`(rowId 기반 snapshot diff), `tableStructureSaveSql.ts`(방언별 생성기), `TableStructureEditor.tsx`(편집 그리드), `TableStructureSaveDialog.tsx`(확인 다이얼로그).

**알려진 제약사항(v1)**:
- PK/FK/Unique/Check 제약조건·인덱스 편집 없음 — 위반 시 DB 원본 에러 그대로 노출.
- 컬럼 순서 변경 없음.
- identity/auto-increment/generated 컬럼은 읽기 전용.
- PostgreSQL에서 `USING` 절이 필요한 타입 변경은 자동 생성 안 함(경고만 표시).
- Oracle CHAR vs BYTE 길이 시맨틱을 완전히 보존하지 않음(타입을 실제로 편집한 경우만 재작성 — MySQL/MariaDB는 `fullTypeName` 필드로 예외적으로 커버).
- Oracle/MySQL DDL은 auto-commit이라 문장 간 트랜잭션 원자성이 없음 — 부분 실패는 몇 번째 문장까지 실행됐는지 보고만 하고 자동 롤백하지 않음.
- 구조 변경 히스토리/원클릭 복원 없음(스냅샷 기능과 달리, 구조 변경은 스냅샷 재실행으로 완전히 복구되지 않으므로 의도적으로 제외).

### 완료 기준

- 명시적 확인 없이 DROP이 실행되지 않음
- read-only에서 수정 메뉴 비활성 또는 차단 메시지
- 1개 이상 드라이버에서 DROP end-to-end 검증

### 요청 문구 예

> DB 탐색기 객체 삭제(DROP)를 안전하게 구현해줘. DDL 미리보기·확인 후에만 실행하고, read-only는 막아줘. Rename은 PostgreSQL/Oracle만 v1로.

---

## 진행 순서

```
6-A 트리 UX + 액션 골격  ✅
 → 6-B DDL 보기
 → 6-C 테이블·뷰 데이터 보기
 → 6-D 검색·새로고침 고도화
 → 6-E 객체 수정 (선택·후순위)
```

- `6-B`와 `6-C`는 **6-A 다음**이면 서로 순서를 바꿔도 된다 (DDL vs 데이터 중 우선순위에 따라).
- `6-D`는 A 이후 언제든 착수 가능; B/C 완료 후 검색 “이동”이 의미 있음.
- `6-E`는 탐색기 “보기”가 갖춰진 뒤, **7번 PL/SQL** 범위와 겹치지 않게 v1만.
- 한 채팅에 **6-A만** 또는 **6-A + 6-C**까지는 가능하나, **6-B(agent DDL)** 부터는 단독 요청 권장.

---

## 같이 넣지 말 것 (로드맵 7+)

- PL/SQL 패키지 본문 편집·컴파일·배포 → **7. PL/SQL 객체 개발**
- AI 자연어→SQL·스키마 질의 → **8. AI 어시스턴트**
- 결과 그리드 안전 UPDATE·페이징 v2 → **5번** (이미 분리됨)

탐색기 요청에 PL/SQL 컴파일·AI를 섞으면 범위가 다시 커진다.

---

## agent / 프로토콜 체크리스트 (6-B·6-E)

| API | 용도 | 단계 |
|-----|------|------|
| `connection.metadata` | 스키마·객체 목록 | ✅ 있음 |
| `connection.columns` | 자동완성 | ✅ 있음 |
| `connection.primaryKeys` | 그리드 UPDATE | ✅ 있음 |
| `connection.ddl` | DDL 보기 | 6-B |
| `query.execute` | 데이터 보기·DROP 실행 | ✅ 있음 (6-C·6-E) |

`packages/db-protocol` README 규칙: **프로토콜 → agent → Tauri → 앱** 순으로 추가.

---

## 다음 단계

Agent 모드에서 **6-E** (객체 수정, 선택·후순위)부터 진행하면 된다.  
(6-A 트리 UX·액션 골격은 완료)
