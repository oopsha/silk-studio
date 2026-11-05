import { I18nService } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import { tKey } from "@silk-studio/workbench/platform/i18n/activeLocale.ts";

const localizedLabels = [
  ["Find / Replace", "settings.editor.findReplace.findReplace", "찾기 / 바꾸기"],
  ["Previous Match", "settings.editor.findReplace.previousMatch", "이전 일치 항목"],
  ["Next Match", "settings.editor.findReplace.nextMatch", "다음 일치 항목"],
  ["Find in Selection", "settings.editor.findReplace.findInSelection", "선택 영역에서 찾기"],
  ["Replace All", "settings.editor.findReplace.replaceAll", "모두 바꾸기"],
  ["Toggle Replace", "settings.editor.findReplace.toggleReplace", "바꾸기 표시 전환"],
  ["Match Whole Word", "settings.editor.findReplace.matchWholeWord", "단어 단위로 일치"],
  ["Use Regular Expression", "settings.editor.findReplace.useRegularExpression", "정규식 사용"],
  ["Match Case", "settings.editor.findReplace.matchCase", "대/소문자 구분"],
  ["Preserve Case", "settings.editor.findReplace.preserveCase", "대/소문자 유지"],
  ["No results", "settings.editor.findReplace.noResults", "결과 없음"],
  ["Find", "settings.editor.findReplace.find", "찾기"],
  ["Replace", "settings.editor.findReplace.replace", "바꾸기"],
  ["Close", "settings.editor.findReplace.close", "닫기"],
] as const;

type FindLabelKey = (typeof localizedLabels)[number][1];

function translateLabel(value: string): string {
  const trimmed = value.trim();
  for (const [english, key, korean] of localizedLabels) {
    if (trimmed === english || trimmed === korean) return tKey(key as FindLabelKey);
    for (const current of [english, korean]) {
      if (trimmed.startsWith(`${current} (`) && trimmed.endsWith(")")) {
        return `${tKey(key as FindLabelKey)}${trimmed.slice(current.length)}`;
      }
    }
  }
  return value;
}

function localizeFindWidgets(root: ParentNode = document): void {
  for (const widget of root.querySelectorAll<HTMLElement>(".find-widget")) {
    for (const element of widget.querySelectorAll<HTMLElement>("[aria-label], [title]")) {
      for (const attribute of ["aria-label", "title"] as const) {
        const value = element.getAttribute(attribute);
        if (value) {
          const localized = translateLabel(value);
          if (localized !== value) element.setAttribute(attribute, localized);
        }
      }
    }
    for (const input of widget.querySelectorAll<HTMLInputElement>("input[placeholder]")) {
      const placeholder = input.getAttribute("placeholder");
      if (placeholder) {
        const localized = translateLabel(placeholder);
        if (localized !== placeholder) input.setAttribute("placeholder", localized);
      }
    }
  }

  // Monaco renders managed hover tooltips in a separate overlay outside the editor widget.
  for (const tooltip of root.querySelectorAll<HTMLElement>(
    ".monaco-hover .hover-contents, .monaco-hover-content, .monaco-hover p",
  )) {
    const walker = document.createTreeWalker(tooltip, NodeFilter.SHOW_TEXT);
    let textNode: Text | null;
    while ((textNode = walker.nextNode() as Text | null)) {
      if (textNode.nodeValue) {
        const localized = translateLabel(textNode.nodeValue);
        if (localized !== textNode.nodeValue) textNode.nodeValue = localized;
      }
    }
  }
}

/** Localize Monaco's Find/Replace labels and managed icon tooltips with the workbench locale. */
export function initializeMonacoFindLocalization(): () => void {
  localizeFindWidgets();
  const observer = new MutationObserver((records) => {
    const relevant = records.some((record) => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target?.closest(".find-widget, .monaco-hover")) return true;
      return Array.from(record.addedNodes).some((node) => {
        if (!(node instanceof Element)) return false;
        return node.matches(".find-widget, .monaco-hover") || !!node.querySelector(".find-widget, .monaco-hover");
      });
    });
    if (relevant) localizeFindWidgets();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-label", "title", "placeholder"],
    characterData: true,
  });
  const unsubscribe = I18nService.onDidChangeLocale(() => localizeFindWidgets());
  return () => {
    observer.disconnect();
    unsubscribe();
  };
}
