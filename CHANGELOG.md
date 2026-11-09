# Changelog

The notes of each version of the Freelens extension for Velero, the newest
first. The section of a version starts with a heading of the form
`## v<version> - <date>`: the tag of the version, `v` and the version as
`package.json` names it, then the date in the form `YYYY-MM-DD`. The notes of
the GitHub release of a version are the lines of its section, from the line
after its heading up to the next line that starts with `##` and a space, or the
end of the file.

## v1.0.0-0 - 2026-11-10

The first prerelease of 1.0.0, published on npm under the tag `next`, with every
view and every action of 1.0.0. It needs Freelens 2.0.0 or a later 2.x release
(`engines.freelens: ^2.0.0`), and it was tested in Freelens 2.0.0 on a
disposable kind cluster with Kubernetes 1.34.11, Velero v1.18.4 and its AWS
plugin v1.14.4.

### New

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
- **Logs and diagnostics.** The writes of the extension, off until they are
  turned on for one cluster and one Velero namespace, each confirmed with the
  names of both. The log, the results, the resource list and the volume
  information of a backup and of a restore, in the tabs of its workspace, each
  loaded only when it is asked for, through a DownloadRequest, and the version
  of the server and its plugins, through a ServerStatusRequest. The downloads
  are made by the main process, with TLS verified against the certificate
  authority the storage location gives, bounded in size, and no signed address
  logged, stored or shown.
- **Schedule adherence and the volumes.** For each schedule, the run it was
  expected to make, the one it made last, the next one, and whether it is
  overdue, with the reason, in its list, its view, the details in Freelens and
  the Overview. The backup repositories, the pod volume backups and restores,
  and the data uploads and downloads of the data movement.
- **Actions.** Back up now from a schedule, create a backup, create a schedule,
  restore from a backup or a schedule with the mappings of the namespaces and
  the policy for the resources that exist, pause and resume a schedule, and
  delete one backup through a DeleteBackupRequest. Each action shows the exact
  request for review before it is sent, and a restore and a deletion ask for
  the name of the backup, typed.
- **Release.** Each version is published on npm by the release workflow of the
  repository, with a provenance attestation, and attached to its GitHub release
  with its checksum and a software bill of materials.

Not in this prerelease yet, and planned before 1.0.0: the sections of the
README on the permissions, with two example roles, on the compatibility and on
the troubleshooting, and the screenshots and the video of the views.
