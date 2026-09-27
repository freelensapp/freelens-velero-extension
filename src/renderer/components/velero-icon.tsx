import { Renderer } from "@freelensapp/extensions";

const {
  Component: { Icon },
} = Renderer;

// An icon of the host for the entry of the sidebar: a backup, in the set the host already ships.
export function VeleroIcon(props: Renderer.Component.IconProps) {
  return <Icon {...props} material="settings_backup_restore" tooltip="Velero" />;
}
