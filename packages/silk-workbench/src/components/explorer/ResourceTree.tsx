import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { resourceIcon, sortResources, type ResourceNode, type ResourceSource } from "./resourceExplorerTypes";
import "./ResourceExplorer.css";

type Props = {
  source: ResourceSource;
  selectedId?: string;
  directoriesOnly?: boolean;
  expandedPath?: readonly string[];
  onSelect: (node: ResourceNode, ancestors: readonly ResourceNode[]) => void;
};

function Branch({ source, node, depth, selectedId, directoriesOnly, expandedPath, onSelect, ancestors = [] }: Props & { node: ResourceNode; depth: number; ancestors?: readonly ResourceNode[] }) {
  const [expanded, setExpanded] = useState(depth === 0);
  const [children, setChildren] = useState<readonly ResourceNode[] | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => { setExpanded(depth === 0); }, [source, node.id, depth]);
  useEffect(() => { if (expandedPath?.includes(node.id)) setExpanded(true); }, [expandedPath, node.id]);
  useEffect(() => {
    if (!node.directory || !expanded) return;
    let active = true;
    setChildren(null);
    setError("");
    Promise.resolve().then(() => source.readChildren(node.id)).then((nodes) => {
      if (active) setChildren(sortResources(nodes));
    }).catch((cause) => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [source, node.id, node.directory, expanded, revision]);

  const icon = resourceIcon(node);
  return <li role="none">
    <button type="button" className={`resource-tree__row${selectedId === node.id ? " resource-tree__row--selected" : ""}`}
      style={{ paddingLeft: 8 + depth * 16 }} role="treeitem" aria-level={depth + 1}
      aria-expanded={node.directory ? expanded : undefined} aria-selected={selectedId === node.id}
      data-resource-id={node.id} tabIndex={selectedId === node.id || (!selectedId && depth === 0) ? 0 : -1}
      onClick={() => { onSelect(node, [...ancestors, node]); if (node.directory) setExpanded(true); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" && node.directory) {
          event.preventDefault(); event.stopPropagation();
          if (!expanded) setExpanded(true);
          else event.currentTarget.parentElement?.querySelector<HTMLElement>('[role="group"] [role="treeitem"]')?.focus();
        } else if (event.key === "ArrowLeft") {
          event.preventDefault(); event.stopPropagation();
          if (expanded && node.directory) setExpanded(false);
          else event.currentTarget.parentElement?.parentElement?.closest('li')?.querySelector<HTMLElement>('[role="treeitem"]')?.focus();
        }
      }}>
      <span className="resource-tree__toggle" aria-hidden onClick={(event) => { if (node.directory) { event.stopPropagation(); setExpanded(!expanded); } }}>
        {node.directory ? <Codicon name={expanded ? "chevron-down" : "chevron-right"} /> : null}
      </span>
      <Codicon name={node.directory && expanded ? "folder-opened" : icon.name} className={icon.className} />
      <span className="resource-tree__name" title={node.name}>{node.name}</span>
    </button>
    {node.directory && expanded ? <ul role="group">
      {error ? <li role="none" className="resource-explorer__message" ><span role="alert">{error}</span><button type="button" onClick={() => setRevision(revision + 1)}>다시 시도</button></li>
        : children === null ? <li role="none" className="resource-explorer__message">불러오는 중…</li>
        : children.filter((child) => !directoriesOnly || child.directory).map((child) => <Branch key={child.id} source={source} node={child} depth={depth + 1} selectedId={selectedId} directoriesOnly={directoriesOnly} expandedPath={expandedPath} onSelect={onSelect} ancestors={[...ancestors, node]} />)}
    </ul> : null}
  </li>;
}

export default function ResourceTree(props: Props) {
  const ref = useRef<HTMLUListElement>(null);
  function navigate(event: KeyboardEvent<HTMLUListElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const rows = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []);
    const index = rows.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : index + (event.key === "ArrowDown" ? 1 : -1);
    rows[Math.max(0, Math.min(rows.length - 1, next))]?.focus();
    event.preventDefault();
  }
  return <ul ref={ref} role="tree" aria-label={props.source.root.name} className="resource-tree" onKeyDown={navigate}>
    <Branch key={props.source.root.id} {...props} node={props.source.root} depth={0} />
  </ul>;
}
