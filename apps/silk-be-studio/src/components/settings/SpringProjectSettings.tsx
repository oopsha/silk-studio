import { useState } from "react";
import {
  DEFAULT_OFFLINE_INDENT_SIZE,
  getOfflineIndentSize,
  setOfflineIndentSize,
} from "../../services/springProjectGenerationSettings.ts";

export default function SpringProjectSettings() {
  const [indentSize, setIndentSize] = useState(getOfflineIndentSize);

  function updateIndentSize(rawValue: string) {
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < 1 || value > 8) return;
    setIndentSize(value);
    setOfflineIndentSize(value);
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Spring 프로젝트</h2>
      <div className="settings-row">
        <div>
          <div className="settings-row__title">오프라인 템플릿 들여쓰기</div>
          <div className="settings-row__description">
            오프라인 프로젝트의 소스, 빌드 파일과 .editorconfig에 적용합니다. 기본값은 {DEFAULT_OFFLINE_INDENT_SIZE}칸입니다.
          </div>
        </div>
        <input
          className="settings-control settings-control--number"
          type="number"
          min={1}
          max={8}
          step={1}
          aria-label="오프라인 템플릿 들여쓰기 칸 수"
          value={indentSize}
          onChange={(event) => updateIndentSize(event.target.value)}
        />
      </div>
    </section>
  );
}
