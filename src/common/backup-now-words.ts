// What the workspace of a backup asked from a schedule says in its own words (SPEC-0017, T4.2): here, apart from the
// workspace, so that the packaged suites read the same words as the views.

export const BACKUP_NOW_VIEW_WORDS = {
  what: (schedule: string, namespace: string) =>
    `A backup made from the template of the schedule ${schedule}, as velero backup create --from-schedule makes it, in ${namespace}. The main process reads the schedule when the review is asked, and again when the backup is created.`,
  writesOff:
    "Writes are off for this installation: the form can be filled, and the review asks for writes on, which are turned on in the target bar.",
  gateUnknown: "Whether writes are on is not known: the target bar asks the main process again.",
  another: (schedule: string) =>
    `A backup asked from the schedule ${schedule} is being created: one is asked at a time, and this one can be asked when it ends.`,
  asking: "Asking the main process for the review: it reads the schedule and writes the backup it would create.",
  running: (name: string) =>
    `Creating the backup ${name}, then reading it every second for thirty seconds at most, until Velero writes its phase.`,
  review: "This Backup will be created when you confirm, and not before:",
  meaning: "What it means",
  text: "What is sent, as it is sent",
  created: (name: string) => `The backup ${name} was created.`,
  phase: (phase: string) => `Velero wrote its phase: ${phase}.`,
  unread: "Velero has not read it yet: it had no phase after thirty seconds of reads. Its view goes on reading it.",
  listed: "The view of the schedule lists it among its backups at its next read.",
  found:
    "The answer of the creation was lost on the way: the backup was found by its name, with the labels of the review, created since the confirmation.",
  unknownLeft:
    "Look for it among the backups before asking again: if it was created, its name is taken, and asking again needs another name.",
  replaced:
    "The schedule changed while the review was read: this review takes the place of the one before, and nothing was created. Read it again before you confirm.",
  earlier: (schedule: string) => `The backup asked from the schedule ${schedule} ended while no workspace showed it:`,
};
