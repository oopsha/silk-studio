# Roadmap

1. 레이아웃 기반 — 사이드바/패널/AI Chat 표시·숨김, sash 크기 조절, 상태 저장/복원, 패널 이동·최대화
2. 환경 설정 — Appearance / Editor / Database / Query Result / AI 설정  
   - UI 언어(en/ko): [`ui-locale-work-breakdown.md`](./ui-locale-work-breakdown.md)
3. DB 연결 관리 — 연결 CRUD·복제, 비밀번호 안전 저장, 재연결, 드라이버/스키마 선택  
   - 다중 DB 세션(탭 바인딩·탭별 결과·상태바/탭 suffix): [`multi-session-work-breakdown.md`](./multi-session-work-breakdown.md) (MC-A~F)
4. SQL 편집 경험 — 문법·포맷·자동완성, 문장/선택 실행, 취소, 히스토리·즐겨찾기, 실행 계획·오류 위치  
   - IntelliSense 고도화: [`sql-intellisense-work-breakdown.md`](./sql-intellisense-work-breakdown.md)
5. 결과 그리드 — 정렬·필터 UX, 컬럼 상태 저장, 복사·CSV, 안전 UPDATE, 대용량/페이지, 다중 결과 탭
   - 에디터 탭 간 결과 격리는 다중 세션 MC-E 참고: [`multi-session-work-breakdown.md`](./multi-session-work-breakdown.md)
6. DB 탐색기 — 스키마/객체 트리, DDL 보기, 테이블 데이터 보기, 검색·새로고침·객체 수정
7. PL/SQL 객체 개발 — 편집/저장/컴파일, 오류 표시, 배포·diff·롤백, (이후) AI 수정 루프 — [`plsql-work-breakdown.md`](./plsql-work-breakdown.md)
8. AI 어시스턴트 — 자연어→SQL→검수→실행→해석, 권한 분리, BYOK/모델, 컨텍스트·감사·비용 — [`ai-assistant-work-breakdown.md`](./ai-assistant-work-breakdown.md)
9. 제품화 기반 — 오류/로그/진단, 자동 업데이트·배포·번들 JRE, 테스트·CI, 접근성·단축키·문서화 — [`productization-work-breakdown.md`](./productization-work-breakdown.md)

## 권장 순서

1 → 2 → 3 → 4·5 → 6 → 7·8 → 9

- 워크벤치 뼈대(레이아웃)와 설정·연결을 먼저 잡고
- SQL 편집과 결과 그리드를 같이 다듬은 뒤
- DB 탐색기로 메타데이터 흐름을 연다
- PL/SQL·AI는 그 기반 위에 올린다
- 제품화(배포·CI·진단 등)는 후반에 병행한다
