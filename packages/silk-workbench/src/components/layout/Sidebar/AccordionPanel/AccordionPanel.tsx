import type { CSSProperties, ReactNode } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import "./AccordionPanel.css";

type AccordionPanelProps = {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children?: ReactNode;
  variant?: "default" | "fill" | "fixed";
  className?: string;
  style?: CSSProperties;
};

function AccordionPanel({
  title,
  expanded,
  onToggle,
  actions,
  children,
  variant = "default",
  className,
  style,
}: AccordionPanelProps) {
  const classes = [
    "accordion-panel",
    expanded ? "accordion-panel--expanded" : "",
    expanded && actions ? "accordion-panel--has-actions" : "",
    variant === "fill" ? "accordion-panel--fill" : "",
    variant === "fixed" ? "accordion-panel--fixed" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classes} style={style}>
      <div className="accordion-panel__header">
        <button
          type="button"
          className="accordion-panel__toggle"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <Codicon
            name={expanded ? "chevron-down" : "chevron-right"}
            className="accordion-panel__twisty"
          />
          <span className="accordion-panel__title">{title}</span>
        </button>
        {expanded && actions ? (
          <div className="accordion-panel__actions">{actions}</div>
        ) : null}
      </div>
      {expanded ? (
        <div className="accordion-panel__body">{children}</div>
      ) : null}
    </section>
  );
}

export default AccordionPanel;
