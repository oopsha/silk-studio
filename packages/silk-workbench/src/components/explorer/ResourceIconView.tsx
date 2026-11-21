import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { resourceIcon, type ResourceNode } from "./resourceExplorerTypes";

/** The icon of a listed item: a codicon, or a coloured label badge for formats such as ZIP and 7Z. */
export default function ResourceIconView({ node, open = false }: { node: Pick<ResourceNode, "name" | "directory" | "icon">; open?: boolean }) {
  const icon = resourceIcon(node as ResourceNode);
  if (icon.label) {
    return <span className="resource-badge" style={{ background: icon.color }} aria-hidden>{icon.label}</span>;
  }
  return <Codicon name={node.directory && open && !node.icon ? "folder-opened" : icon.name} className={icon.className} />;
}
