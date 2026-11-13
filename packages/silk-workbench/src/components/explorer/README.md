# 공통 리소스 탐색기

`ResourceSource`는 루트 노드와 `readChildren(directoryId)`만 제공합니다.
UI는 ID를 실제 파일 경로로 해석하지 않습니다. 소스 객체는 `useMemo` 등으로
안정적으로 유지하며, 루트나 데이터가 바뀔 때 새 소스 객체로 교체합니다.

- `ResourceTree`: VS Code 파일 아이콘과 촘촘한 트리 행을 사용하며, 지연 로딩,
  폴더 펼침/접기, 선택, 키보드 탐색, 오류 및 재시도를 지원합니다.
  `onSelect`에는 노드와 루트부터 선택 노드까지의 경로를 전달합니다.
- `ResourceExplorer`: VS Code 워크벤치 톤의 헤더/경로 표시와 폴더 트리 + 현재 폴더 목록.
  `onOpenFile`은 앱이 제공하며 추가 열은 `extraColumns`로 지정할 수 있습니다.
  폴더는 더블클릭이나 Enter로 열고, 현재 폴더의 직계 자식만 표시합니다.
- `WorkbenchSash`와 `LayoutService`를 재사용하므로 트리 너비도 저장됩니다.
- 목록은 폴더 우선·이름 순으로 정렬하고 500개 단위로 표시합니다.

사용처:
- Silk Zip의 `createArchiveSource`: 엔진 결과를 가상 폴더 구조로 변환합니다.
  명시적인 폴더 헤더가 없는 ZIP도 처리하고 동일 이름의 파일 항목을 보존합니다.
- BE Studio의 `createProjectSource`: 펼친 폴더를 Tauri의 `readDir`로 읽습니다.
  기존 제외 폴더 정책을 유지하고, 심볼릭 링크 폴더는 재귀 탐색하지 않습니다.

이 컴포넌트는 파일 시스템 읽기, 압축 해제, 편집기 열기, DB 조회를 직접 수행하지 않습니다.
