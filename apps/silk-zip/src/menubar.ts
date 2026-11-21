import { MenuId } from "@silk-studio/workbench/platform/actions/menuId.ts";
import { detectWorkbenchPlatform } from "@silk-studio/ui/platform/fonts.ts";
import { MenuRegistry } from "@silk-studio/workbench/platform/actions/menuRegistry.ts";

const registrationState = globalThis as typeof globalThis & {
  __silkZipMenusRegistered?: boolean;
};

if (!registrationState.__silkZipMenusRegistered) {
  registrationState.__silkZipMenusRegistered = true;

const menus = [
  [MenuId.MenubarFileMenu, "파일"],
  [MenuId.MenubarEditMenu, "편집"],
  [MenuId.MenubarViewMenu, "보기"],
  [MenuId.MenubarToolsMenu, "도구"],
  [MenuId.MenubarHelpMenu, "도움말"],
] as const;

menus.forEach(([submenu, title], order) => {
  MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, { submenu, title, order });
});

const fileItems = [
  { id: "silkZip.file.openArchive", title: "압축 파일 열기...", group: "1_open", order: 10 },
  { id: "silkZip.file.recent", title: "최근 파일 열기", submenu: MenuId.MenubarRecentZipMenu, group: "1_open", order: 20 },
  { id: "silkZip.file.newArchive", title: "새 압축 만들기", group: "1_open", order: 30, shortcut: "Ctrl+N" },
  { id: "silkZip.file.closeArchive", title: "압축 파일 닫기", group: "2_archive", order: 10, shortcut: "F4" },
  { id: "silkZip.file.saveAs", title: "다른 이름으로 저장...", group: "2_archive", order: 20 },
  { id: "silkZip.file.openFolder", title: "압축 파일 위치 열기", group: "2_archive", order: 50 },
  { id: "silkZip.file.test", title: "압축 파일 테스트", group: "2_archive", order: 60, shortcut: "Ctrl+T" },
  { id: "silkZip.file.extract", title: "압축 풀기...", group: "2_archive", order: 80, shortcut: "Ctrl+E" },
  { id: "silkZip.file.extractHere", title: "현재 폴더에 풀기", group: "2_archive", order: 81, shortcut: "Ctrl+Shift+C" },
  { id: "silkZip.file.extractNamed", title: "압축 파일 이름 폴더에 풀기", group: "2_archive", order: 82, shortcut: "Ctrl+Shift+S" },
  { id: "silkZip.file.newFolder", title: "새 창 열기", group: "3_window", order: 10, shortcut: "Ctrl+Shift+N" },
  { id: "silkZip.file.newFolderAdmin", title: "새 창 열기(관리자)", group: "3_window", order: 20, shortcut: "Ctrl+Alt+N" },
  { id: "workbench.action.openSettings", title: "설정", group: "4_settings", order: 10 },
  { id: "silkZip.file.exit", title: "종료", group: "5_exit", order: 10, shortcut: "Ctrl+W" },
] as const;

for (const item of fileItems) {
  // Elevated windows exist only on Windows.
  if (item.id === "silkZip.file.newFolderAdmin" && detectWorkbenchPlatform() !== "windows") continue;
  if ("submenu" in item) {
    MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
      submenu: item.submenu,
      title: item.title,
      group: item.group,
      order: item.order,
    });
  } else {
    MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
      command: { id: item.id, title: item.title },
      group: item.group,
      order: item.order,
    });
  }
}

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
  command: { id: "workbench.action.showCommands", title: "명령 팔레트..." },
  group: "group-0",
  order: -1,
});

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
  command: { id: "workbench.action.navigateBack", title: "뒤로 가기" },
  group: "group-9",
  order: 90,
});
MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
  command: { id: "workbench.action.navigateForward", title: "앞으로 가기" },
  group: "group-9",
  order: 91,
});

const otherMenus = [
  [MenuId.MenubarEditMenu, ["이름 바꾸기|F2", "파일 추가|Ins", "제거|Del", "|", "복사|Ctrl+C", "붙여넣기|Ctrl+V", "|", "찾기...|Ctrl+F"]],
  [MenuId.MenubarViewMenu, ["보기 형식", "표시할 열", "테마"]],
  [MenuId.MenubarToolsMenu, ["손상된 압축 파일 복구...", "압축 파일 암호 복구..."]],
  [MenuId.MenubarHelpMenu, ["정보|F1", "프로그램 설치 폴더 열기", "|", "도움말 페이지 열기", "토론 게시판 열기", "홈페이지 열기"]],
] as const;

for (const [menuId, labels] of otherMenus) {
  labels.forEach((entry, order) => {
    if (entry === "|") return;
    if (menuId === MenuId.MenubarViewMenu && order === 0) {
      MenuRegistry.appendMenuItem(menuId, {
        submenu: MenuId.MenubarSelectionMenu,
        title: "보기 형식",
        group: `group-${labels.slice(0, order).filter((label) => label === "|").length}`,
        order,
      });
      return;
    }
    if (menuId === MenuId.MenubarViewMenu && order === 1) {
      MenuRegistry.appendMenuItem(menuId, {
        submenu: MenuId.MenubarFindMenu,
        title: "표시할 열",
        group: "group-0",
        order,
      });
      return;
    }
    if (menuId === MenuId.MenubarViewMenu && order === 2) {
      MenuRegistry.appendMenuItem(menuId, {
        submenu: MenuId.GlobalActivityThemesSubmenu,
        title: "테마",
        group: `group-${labels.slice(0, order).filter((label) => label === "|").length}`,
        order,
      });
      return;
    }
    if (menuId === MenuId.MenubarEditMenu && order === 0) {
      MenuRegistry.appendMenuItem(menuId, {
        command: { id: "silkZip.edit.rename", title: "이름 바꾸기" },
        group: "group-0",
        order,
      });
      return;
    }
    if (menuId === MenuId.MenubarEditMenu && order === 1) {
      MenuRegistry.appendMenuItem(menuId, { command: { id: "silkZip.edit.addFiles", title: "파일 추가" }, group: "group-0", order });
      MenuRegistry.appendMenuItem(menuId, { command: { id: "silkZip.edit.addFolder", title: "폴더 추가" }, group: "group-0", order: order + 0.5 });
      return;
    }
    if (menuId === MenuId.MenubarEditMenu && order === 4) {
      MenuRegistry.appendMenuItem(menuId, { command: { id: "silkZip.edit.copy", title: "복사" }, group: "group-1", order });
      return;
    }
    if (menuId === MenuId.MenubarEditMenu && order === 5) {
      MenuRegistry.appendMenuItem(menuId, { command: { id: "silkZip.edit.paste", title: "붙여넣기" }, group: "group-1", order });
      return;
    }
    if (menuId === MenuId.MenubarEditMenu && order === 7) {
      MenuRegistry.appendMenuItem(menuId, { command: { id: "silkZip.edit.find", title: "찾기..." }, group: "group-2", order });
      return;
    }
    if (menuId === MenuId.MenubarEditMenu && order === 2) {
      MenuRegistry.appendMenuItem(menuId, { command: { id: "silkZip.edit.delete", title: "제거" }, group: "group-0", order });
      return;
    }
    const [title, shortcut] = entry.split("|");
    MenuRegistry.appendMenuItem(menuId, {
      command: { id: `silkZip.placeholder.${menuId.id}.${order}`, title },
      group: `group-${labels.slice(0, order).filter((label) => label === "|").length}`,
      order,
    });
    void shortcut;
  });
}

["큰 아이콘", "아이콘", "목록", "자세히"].forEach((title, order) => {
  MenuRegistry.appendMenuItem(MenuId.MenubarSelectionMenu, {
    command: { id: `silkZip.viewMode.${order}`, title },
    group: "1_viewModes",
    order: order + 1,
  });
});

["압축 크기", "원본 크기", "파일 종류", "수정한 날짜", "|", "압축 방식", "암호 방식", "CRC", "속성", "파일 설명", "부가 정보"].forEach((entry, order) => {
  if (entry === "|") return;
  const group = order < 4 ? "1_primary" : "2_additional";
  MenuRegistry.appendMenuItem(MenuId.MenubarFindMenu, {
    command: { id: `silkZip.column.${order}`, title: entry },
    group,
    order,
  });
});
}
