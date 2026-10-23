import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { agoText, SIGNAL_WORDS, scheduleSignal } from "../../common/schedule-signal";
import { ownedText, pausedText, scheduleView, zoneText } from "../../common/schedule-view";
import { AdherenceMark, adherenceTip, BAND_WORDS, NextRunText } from "../components/adherence";
import { time } from "../components/status";
import { useNow } from "../components/views-frame";
import { adherenceOf, backupsAnswered, unreadAdherence } from "../state/adherence";
import { currentInstallation } from "../state/context";
import { READ_EVERY } from "../state/installation";
import { WorkspaceLink } from "./workspace-link";

import type { ScheduleSignal } from "../../common/schedule-signal";
import type { ScheduleResource } from "../../common/types";
import type { Schedule } from "../api/kinds";
import type { Installation } from "../state/installation";

const {
  Component: { DrawerItem, DrawerTitle, LocaleDate },
} = Renderer;

export interface ScheduleDetailsProps extends Renderer.Component.KubeObjectDetailsProps<Schedule> {
  extension: Renderer.LensExtension;
  installation?: Installation;
}

// The adherence the details say of a schedule. Of the namespace the installation reads, it is computed with
// what the views read, and is nothing while the backups were never answered, as in the list; the views ask
// again only while one of them is open, so the age of that read is said when none is, or when it is older than
// the period of the reads. Of another namespace nothing of its installation was read, its backups and the
// offset of its server among it: it is computed with the reads of no family, and says so.
function adherence(
  resource: ScheduleResource,
  namespace: string,
  installation: Installation,
  now: number,
): { signal: ScheduleSignal; age?: string } | undefined {
  if (installation.namespace !== namespace) return { signal: scheduleSignal(resource, unreadAdherence(now)) };
  if (!backupsAnswered(installation)) return undefined;
  const signal = scheduleSignal(resource, adherenceOf(installation, now));
  const read = installation.read("backups").lastSuccess;

  if (read === undefined || (installation.watched && now - read <= READ_EVERY)) return { signal };
  return { signal, age: SIGNAL_WORDS.readOfTheViews(agoText(read, now), !installation.watched) };
}

// What the details of the host show of a Schedule, where the host opens them: the same reading of the
// object the views of the extension give, in short, its adherence in the words of the list, with the date of
// the next run as the host writes one, and the way to the workspace, where the history is. It asks nothing of
// the cluster. Its clock is its own, and ends with it.
export const ScheduleDetails = observer(({ object, extension, installation }: ScheduleDetailsProps) => {
  const now = useNow();

  if (!object) return null;
  const resource = object as unknown as ScheduleResource;
  const view = scheduleView(resource);
  const shown = installation ?? currentInstallation();
  const said = adherence(resource, view.namespace, shown, now);

  return (
    <div data-testid="velero-schedule-details">
      <DrawerTitle>Velero</DrawerTitle>
      <DrawerItem name="Validation">{view.state.label}</DrawerItem>
      <DrawerItem name="Paused">{pausedText(view.paused)}</DrawerItem>
      <DrawerItem name="Schedule">{view.expression.written ?? "Not reported"}</DrawerItem>
      <DrawerItem name="Time zone">{zoneText(view.expression.zone)}</DrawerItem>
      {said ? (
        <>
          <DrawerItem name="Next run">
            <NextRunText next={said.signal.next} />
            {said.signal.next.kind === "at" ? (
              <span data-host-time>
                {BAND_WORDS.hostTime} <LocaleDate date={new Date(said.signal.next.at)} />
              </span>
            ) : null}
          </DrawerItem>
          <DrawerItem name="Adherence">
            <AdherenceMark signal={said.signal} />{" "}
            <span data-adherence-words>{[adherenceTip(said.signal), said.age].filter(Boolean).join(" ")}</span>
          </DrawerItem>
        </>
      ) : null}
      <DrawerItem name="Last submission">{time(view.lastSubmission)}</DrawerItem>
      <DrawerItem name="Last skipped">{time(view.lastSkipped)}</DrawerItem>
      <DrawerItem name="Backups owned by the schedule">{ownedText(view.owned)}</DrawerItem>
      <DrawerItem name="Installation">{view.namespace}</DrawerItem>
      {view.validationErrors.length ? (
        <DrawerItem name="Validation errors">{view.validationErrors.join("; ")}</DrawerItem>
      ) : null}
      {view.notes.length ? <DrawerItem name="Notes">{view.notes.join(" ")}</DrawerItem> : null}
      <WorkspaceLink
        extension={extension}
        installation={shown}
        target={{ kind: "schedule", name: view.name }}
        namespace={view.namespace}
      />
    </div>
  );
});
