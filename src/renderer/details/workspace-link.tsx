import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { VIEWS } from "../../common/views";
import { viewUrl } from "../navigation";

import type { ViewTarget } from "../../common/views";
import type { Installation } from "../state/installation";

const {
  Component: { DrawerItem, MaybeLink },
} = Renderer;

export interface WorkspaceLinkProps {
  extension: Renderer.LensExtension;
  installation: Installation;
  target: ViewTarget;
  namespace: string;
}

// The way from the details of the host to the view of the extension. The views show the objects of the
// installation that is selected: an object of another namespace is not there, and a link to it would open
// one of the same name or none. The selection may change while the details are open.
export const WorkspaceLink = observer(({ extension, installation, target, namespace }: WorkspaceLinkProps) => {
  const selected = installation.selection;
  const there = (selected.state === "selected" || selected.state === "stale") && selected.namespace === namespace;
  const { noun } = VIEWS[target.kind];

  return (
    <DrawerItem name="Workspace">
      {there ? (
        <MaybeLink to={viewUrl(extension.name, target)} data-testid={`velero-${target.kind}-details-link`}>
          Open among the {noun}s of Velero
        </MaybeLink>
      ) : (
        <span data-testid={`velero-${target.kind}-details-elsewhere`}>
          Select {namespace} among the {noun}s of Velero to open it there
        </span>
      )}
    </DrawerItem>
  );
});
