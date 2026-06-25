import type { MenuId } from "./menuId";

export type LocalizedString =
  | string
  | {
      value: string;
      mnemonicTitle?: string;
    };

export interface ICommandActionTitle {
  value: string;
  mnemonicTitle?: string;
}

export interface ICommandAction {
  id: string;
  title: string | ICommandActionTitle;
  icon?: string;
  toggled?: {
    icon?: string;
    condition?: string;
  };
}

export interface IMenuItem {
  command: ICommandAction;
  group?: string;
  order?: number;
  when?: string;
}

export interface ISubmenuItem {
  title: string | ICommandActionTitle;
  submenu: MenuId;
  group?: string;
  order?: number;
  when?: string;
}

export function isMenuItem(item: IMenuItem | ISubmenuItem): item is IMenuItem {
  return "command" in item;
}

export function isSubmenuItem(item: IMenuItem | ISubmenuItem): item is ISubmenuItem {
  return "submenu" in item;
}

export function getLocalizedValue(title: string | ICommandActionTitle): string {
  return typeof title === "string" ? title : title.value;
}

export function getMnemonicTitle(
  title: string | ICommandActionTitle,
): string | undefined {
  if (typeof title === "string") return undefined;
  return title.mnemonicTitle;
}

/** "&&File" → { label: "File", mnemonic: "F" } */
export function parseMnemonic(title: string): {
  label: string;
  mnemonic?: string;
} {
  const match = title.match(/^([^&]*?)&&(.)(.*)$/);
  if (!match) {
    return { label: title.replace(/&&/g, "") };
  }
  const [, before, letter, after] = match;
  return {
    label: `${before}${letter}${after}`,
    mnemonic: letter.toUpperCase(),
  };
}

export function resolveMenuLabel(title: string | ICommandActionTitle): {
  label: string;
  mnemonic?: string;
} {
  const mnemonicTitle = getMnemonicTitle(title);
  if (mnemonicTitle) {
    return parseMnemonic(mnemonicTitle);
  }
  return { label: getLocalizedValue(title) };
}
