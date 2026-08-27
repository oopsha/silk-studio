import { useEffect, useState } from "react";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { bridgeListPackageMembers } from "../../services/connection/connectionBridge";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import type { ObjectEditorRef } from "../../services/connection/objectEditorConstants";
import {
  getCachedObjectPreview,
  setCachedObjectPreview,
} from "../../services/connection/objectPreviewCache";
import "./TablePropertySection.css";

type PackageMember = { name: string; kind: "procedure" | "function" };

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; members: PackageMember[] };

type PackageMembersPreviewProps = {
  objectRef: ObjectEditorRef;
  /** Which half of the package's member list this instance shows. */
  memberKind: "procedure" | "function";
  /** Double-click a member to jump to its implementation in the Body source. */
  onOpenMember: (name: string) => void;
};

/** Lists a package's procedure or function members — double-click reveals it in Body. */
function PackageMembersPreview({
  objectRef,
  memberKind,
  onOpenMember,
}: PackageMembersPreviewProps) {
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const cached = getCachedObjectPreview<PackageMember[]>("packageMembers", objectRef);
    if (cached) {
      setLoadState({ status: "ready", members: cached });
      return;
    }

    let cancelled = false;
    setLoadState({ status: "loading" });

    void bridgeListPackageMembers(
      objectRef.profileId,
      objectRef.schemaName,
      objectRef.objectName,
      objectRef.catalogName ?? undefined,
    )
      .then((result) => {
        if (cancelled) return;
        setLoadState({ status: "ready", members: result.members });
        setCachedObjectPreview("packageMembers", objectRef, result.members);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadState({
          status: "error",
          message: formatErrorMessage(error, t("app.packageMembers.loadFailed")),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    objectRef.profileId,
    objectRef.schemaName,
    objectRef.objectName,
    objectRef.catalogName,
    t,
  ]);

  if (loadState.status === "loading") {
    return (
      <div className="table-property-section__status">{t("app.packageMembers.loading")}</div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="table-property-section__status table-property-section__status--error">
        {loadState.message}
      </div>
    );
  }

  const filtered = loadState.members.filter((member) => member.kind === memberKind);

  if (filtered.length === 0) {
    return (
      <div className="table-property-section__status">
        {t("app.packageMembers.empty")}
      </div>
    );
  }

  return (
    <div className="table-property-section">
      <table className="table-property-section__table">
        <thead>
          <tr>
            <th className="table-property-section__index-cell">#</th>
            <th>{t("app.packageMembers.name")}</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((member, index) => (
            <tr
              key={member.name}
              className="table-property-section__row--clickable"
              onDoubleClick={() => onOpenMember(member.name)}
              title={t("app.packageMembers.openHint")}
            >
              <td className="table-property-section__index-cell">{index + 1}</td>
              <td>{member.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default PackageMembersPreview;
