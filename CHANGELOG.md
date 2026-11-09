# Changelog

The notes of each version of the Freelens extension for Velero, the newest
first. The section of a version starts with a heading of the form
`## v<version> - <date>`: the tag of the version, `v` and the version as
`package.json` names it, then the date in the form `YYYY-MM-DD`. The date of a
section is the day of the pull request of its version, which sets it; until then
it is the day planned. The notes of the GitHub release of a version are the lines
of its section, from the line after its heading up to the next line that starts
with `##` and a space, or the end of the file.

## v1.0.0 - 2026-11-16

The first release of the extension: the backups, the restores, the schedules and
the storage locations of Velero, with their logs and their results, inside
Freelens and across every cluster it connects to. It needs Freelens 2.0.0 or a
later 2.x release (`engines.freelens: ^2.0.0`) and a cluster with Velero, read
through `velero.io/v1` and `velero.io/v2alpha1`, and nothing installed in the
cluster beside Velero. It was tested with Freelens 2.0.0, Velero v1.18.4 and its
AWS plugin v1.14.4, on Kubernetes 1.34.11, on Linux ARM64 and on macOS; any other
version or platform, Velero 1.19 and Windows among them, is untested.

### Added

- **Discovery and backups.** The Velero installations of a cluster, discovered
  or configured, with the choice among several, and the states of an
  installation that is missing, forbidden to the identity or empty. The Backups,
  in a list and in a workspace for each backup: its phase and its progress, its
  storage location, its schedule, the restores made from it, and what failed.
- **Restores, schedules, locations and the Overview.** The Restores, with the
  backup or the schedule they come from and the progress of the recovery. The
  Schedules, with what a pause and a skipped run do, and the backups of each.
  The backup storage locations and the volume snapshot locations: the default,
  the access mode, the availability, the times of the last validation and of the
  last sync, and the errors. The Overview of an installation: what needs
  attention beside what was read, with no single value for the installation,
  and the way into each object.
- **Logs and diagnostics.** The log, the results, the resource list and the
  volume information of a backup and of a restore, in the tabs of its workspace,
  each loaded only when it is asked for, through a DownloadRequest, and the
  version of the server and its plugins, through a ServerStatusRequest.
- **Schedule adherence and the volumes.** For each schedule, the run it was
  expected to make, the one it made last, the next one, and whether it is
  overdue, with the reason, in its list, its view, the details in Freelens and
  the Overview. The backup repositories, the pod volume backups and restores,
  and the data uploads and downloads of the data movement.
- **Actions.** Back up now from a schedule, create a backup, create a schedule,
  restore a backup, from its view or from the view of the schedule that made it,
  with the mappings of the namespaces and the policy for the resources that
  exist, pause and resume a schedule, and delete one backup through a
  DeleteBackupRequest.

### Safety

The extension reads first, and writes nothing until writes are turned on for
one installation of Velero of one cluster. Then each write is confirmed on the
exact request it sends, a restore and a deletion ask for the name of the backup
typed, and a backup is deleted only through a DeleteBackupRequest, one at a
time. Signed URLs stay in the main process and are never logged, stored or
shown, TLS is verified by default, and missing data is shown as unknown, never
as healthy.

### Install and verify

Enter `@freelensapp/velero-extension` on the Extensions page of Freelens, or
give it the tarball of this release with its `.tgz.sha256` next to it. Check the
tarball against its `.tgz.sha256` with `sha256sum -c` or `shasum -a 256 -c`, and
the provenance of the package with `npm audit signatures` in a project that
installs it, as the
[README](https://github.com/freelensapp/freelens-velero-extension#verify-a-release)
says.

### Known limits

- The data movement, and the phases of a failure other than FailedValidation,
  were proven on synthetic objects only.
- Editing a schedule and the panels of backup coverage are not in this version.
