# DBeaver 비교 — 갭 분석 및 작업 배분

로드맵 Phase 1~9 완료 이후 이어지는 Phase 10~15로 구성한다.
(형식은 [`sql-editing-work-breakdown.md`](./sql-editing-work-breakdown.md)와 동일)

컨셉: **DBeaver Community Edition(`D:\temp\dbeaver`)의 기능을 기본 지원 + 유용한 추가 기능**.
단, DBeaver의 모든 기능을 따라가지 않고 사용 빈도가 낮은 것은 선별 제외한다.

## 조사 방법

- DBeaver CE 소스: `D:\temp\dbeaver` (shallow clone, `--depth 1`)
- Silk 현재 상태: `docs/roadmap.md` + 각 work-breakdown 문서 + `apps/silk-db-studio` 구조 확인

## 이미 DBeaver 대비 강점인 부분 (유지·강화)

- AI 어시스턴트 (BYOK, NL→SQL, diff 리뷰, gated 실행, 감사로그) — DBeaver CE에 없는 수준
- PL/SQL 전용 툴링 (로컬 스냅샷/diff/롤백, 컴파일 에러 마커, AI 의존성 분석)
- 탭별 독립 커넥션 (Multi-session)
- AWS SSM 터널 내장
- Zero-dependency 런타임 (JRE 번들)
- Safe UPDATE (PK 게이팅 + 프리뷰)

## DBeaver엔 있고 Silk엔 없는 것 (갭)

| 영역 | DBeaver 근거 | 우선순위 | 관련 Phase |
|---|---|---|---|
| ERD(스키마 다이어그램) | GEF 기반 에디터, 리버스 엔지니어링 생성 | 높음 | Phase 11 |
| Export 포맷 확장 (JSON/XML/SQL insert/Excel/Markdown) | `DataExporterCSV/JSON/XML/SQL/Markdown` 등 | 높음 | Phase 10 |
| 셀 전용 뷰어 (BLOB/이미지/JSON/XML/Hex) | `ui.editors.hex/.image/.json/.xml` | 높음 | Phase 10 |
| FK 참조 네비게이션 패널 | `ReferencesPanel` | 중간 | Phase 10 |
| 그룹/집계 패널 | `AggregateColumnsPanel`, `GroupingPanel` | 중간 | Phase 10 |
| 스키마/DB 비교(Diff) | `cmp.simple` 플러그인 | 중간 | Phase 12 |
| 네이티브 백업/복원 (pg_dump 등 래핑) | Postgres 백업 핸들러 확인 | 중간 | Phase 13 |
| 세션/락 관리자(Kill session 등) | Oracle/PG/MySQL/MSSQL 등 6개 이상 DB에 구현됨 | 중간 | Phase 14 |
| 권한/보안(Grant·Role) 관리 UI | `ui.editors.acl` | 낮음~중간 | Phase 15 |
| Task 스케줄러(반복 백업/내보내기) | CE에서도 Task 프레임워크는 있으나 cron형 반복은 Enterprise 전용으로 보임 | 낮음 | 백로그 |
| 대시보드(라이브 메트릭 차트) | `model.dashboard` | 낮음 | 백로그 |
| PL/pgSQL 등 인터랙티브 디버거(브레이크포인트) | `debug.core`/`.ui` | 낮음 | 백로그 |

## 명시적으로 제외하는 것 (사용 빈도 대비 비용 過)

- **60+ DB 드라이버 breadth** (Teradata/Vertica/Doris 등 exotic DB) — 현재 5종(Oracle/PostgreSQL/MySQL/MariaDB/SQL Server) 중심 유지, 수요 있으면 SQLite/ClickHouse/Snowflake 정도만 추가 검토
- **GIS/공간 데이터 렌더링** — 사용 빈도 매우 낮음
- **NoSQL 지원** — DBeaver CE 자체에도 없음
- **플러그인/확장 아키텍처(OSGi급)** — 제품 포커스를 흐림, 필요성 낮음
- **다국어 로컬라이제이션 확장 (en/ko 외)** — ROI 낮음
- **Git/Flyway/Liquibase 통합** — 로드맵에서 기존에 이미 제외된 방침 유지
- **인터랙티브 PL/SQL 디버거(브레이크포인트)** — 구현 비용 매우 크고 사용률 낮아 백로그로 보류

---

## Phase 10. 그리드 고도화

**상태:** 미착수

**의존성:** 없음 (기존 결과 그리드 5번 위에 얹음)

### 범위

- 셀 전용 뷰어: JSON / XML / BLOB(바이너리·Hex) / 이미지
- FK 참조 네비게이션 패널 (DBeaver `ReferencesPanel` 대응)
- 그룹/집계 패널 (DBeaver `AggregateColumnsPanel`/`GroupingPanel` 대응)
- Export 포맷 확장: JSON, XML, SQL INSERT 스크립트, Markdown, Excel (현재 CSV만 지원)

### 완료 기준

- 대표 데이터 타입(JSON/BLOB/이미지)에 대해 전용 뷰어가 그리드 셀에서 열림
- FK 컬럼에서 참조 로우로 바로 이동할 수 있음
- CSV 외 최소 2개 포맷(JSON, SQL INSERT) export 가능

### 요청 문구 예

> 결과 그리드에 JSON/BLOB/이미지 셀 뷰어, FK 참조 패널, JSON/SQL export를 추가해줘.

---

## Phase 11. ERD (스키마 다이어그램)

**상태:** 미착수

**의존성:** DB 탐색기(6), DDL 보기(6-B)

### 범위

- 스키마 선택 시 테이블·FK 관계 기반 다이어그램 자동 생성 (리버스 엔지니어링)
- 테이블 단위 / 스키마 단위 두 모드
- 기본 편집(레이아웃 이동, 노트/주석) — DBeaver GEF 에디터 수준의 완전 편집은 1차 범위 아님

### 완료 기준

- 스키마를 선택하면 테이블·FK 관계가 다이어그램으로 렌더링됨
- Oracle/PostgreSQL부터 지원, 나머지 드라이버는 가능한 범위만

### 요청 문구 예

> DB 탐색기에서 스키마 ERD를 볼 수 있게 해줘. FK 관계 기반 자동 생성으로 시작해줘.

---

## Phase 12. 스키마/DB 비교 (Diff)

**상태:** 미착수

**의존성:** DDL 보기(6-B), PL/SQL 로컬 diff 인프라(7-D) 재사용 가능

### 범위

- 두 스키마(또는 동일 스키마의 두 시점) 간 테이블/컬럼/인덱스/제약조건 DDL 비교
- 결과를 diff 뷰로 표시 (7-D에서 쓰는 diff 컴포넌트 재사용)

### 완료 기준

- 두 대상을 선택해 DDL 레벨 diff를 볼 수 있음

### 요청 문구 예

> 두 스키마를 비교해서 테이블/컬럼 DDL 차이를 diff로 보여주는 기능을 추가해줘.

---

## Phase 13. 백업/복원

**상태:** 미착수

**의존성:** 없음

### 범위

- PostgreSQL: `pg_dump`/`pg_restore` 래핑
- MySQL/MariaDB: `mysqldump` 래핑
- Oracle: `expdp`/`impdp` 래핑 (선택, 환경 의존성 높음)
- 실행 결과를 Task 개념으로 저장 (반복 스케줄링은 Phase 범위 밖, 백로그)

### 완료 기준

- PostgreSQL 기준 백업/복원이 UI에서 실행되고 결과를 확인할 수 있음

### 요청 문구 예

> PostgreSQL pg_dump/pg_restore를 래핑한 백업/복원 기능을 추가해줘.

---

## Phase 14. 관리자 패널 (세션/락)

**상태:** 미착수

**의존성:** 없음

### 범위

- 세션 목록 뷰어 (활성 커넥션, 쿼리, 상태)
- 락(lock) 목록 뷰어
- 세션 Kill 액션
- 지원 순서: Oracle → PostgreSQL → MySQL → SQL Server (이미 지원 중인 dialect 순)

### 완료 기준

- 최소 1개 DB(Oracle 또는 PostgreSQL)에서 세션/락 조회 + Kill이 동작함

### 요청 문구 예

> Oracle/PostgreSQL 세션·락 관리자 패널을 추가해줘. 세션 목록 조회와 Kill 액션부터 구현해줘.

---

## Phase 15. 권한 관리 (Grant/Role)

**상태:** 미착수 (우선순위 낮음)

**의존성:** 없음

### 범위

- 사용자/역할(Role) 목록 조회
- 테이블/스키마 단위 Grant 조회, 기본 Grant/Revoke 실행

### 완료 기준

- 최소 1개 DB에서 Grant 목록을 읽기 전용으로 볼 수 있음

### 요청 문구 예

> PostgreSQL 기준으로 역할/Grant 조회 UI를 추가해줘.

---

## 백로그 (보류)

- 대시보드/라이브 메트릭 차트
- Task 반복 스케줄러 (cron형 백업/export 자동화)
- 인터랙티브 PL/SQL 디버거 (브레이크포인트)
- Linux 포팅
