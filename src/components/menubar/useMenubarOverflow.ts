import { useLayoutEffect, useState, type RefObject } from "react";
import type { ResolvedMenuSubmenu } from "../../platform/actions/menuService";

const OVERFLOW_BUTTON_WIDTH = 38;

type MenubarOverflowState = {
  visibleCount: number;
  hasOverflow: boolean;
};

function computeVisibleCount(
  menuWidths: number[],
  availableWidth: number,
  overflowButtonWidth: number,
): MenubarOverflowState {
  const total = menuWidths.length;
  if (total === 0) {
    return { visibleCount: 0, hasOverflow: false };
  }

  let used = 0;
  let visibleCount = 0;

  for (let index = 0; index < total; index++) {
    const width = menuWidths[index] ?? 0;
    const hiddenRemaining = total - index - 1;
    const reserveOverflow = hiddenRemaining > 0 ? overflowButtonWidth : 0;

    if (used + width + reserveOverflow > availableWidth && visibleCount > 0) {
      break;
    }

    if (used + width > availableWidth && visibleCount > 0) {
      break;
    }

    used += width;
    visibleCount++;
  }

  if (visibleCount > 0 && visibleCount - 1 <= total / 4) {
    return { visibleCount: 0, hasOverflow: true };
  }

  return {
    visibleCount,
    hasOverflow: visibleCount < total,
  };
}

export function useMenubarOverflow(
  menus: ResolvedMenuSubmenu[],
  containerRef: RefObject<HTMLDivElement | null>,
  measureRef: RefObject<HTMLDivElement | null>,
): MenubarOverflowState {
  const [state, setState] = useState<MenubarOverflowState>({
    visibleCount: menus.length,
    hasOverflow: false,
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function updateLayout() {
      const containerEl = containerRef.current;
      const measureEl = measureRef.current;
      if (!containerEl || !measureEl) return;

      const availableWidth = containerEl.offsetWidth;
      if (availableWidth <= 0) return;

      const buttons = measureEl.querySelectorAll<HTMLElement>("[data-menu-measure]");
      const menuWidths = [...buttons]
        .slice(0, menus.length)
        .map((button) => button.offsetWidth);

      const overflowButton = measureEl.querySelector<HTMLElement>(
        "[data-overflow-measure]",
      );
      const overflowWidth = overflowButton?.offsetWidth ?? OVERFLOW_BUTTON_WIDTH;

      const next = computeVisibleCount(
        menuWidths,
        availableWidth,
        overflowWidth,
      );
      setState((current) =>
        current.visibleCount === next.visibleCount &&
        current.hasOverflow === next.hasOverflow
          ? current
          : next,
      );
    }

    updateLayout();

    const observer = new ResizeObserver(updateLayout);
    observer.observe(container);

    return () => observer.disconnect();
  }, [containerRef, measureRef, menus]);

  return state;
}
