import { describe, expect, it } from "vitest";
import { expressionZone, nextInstant, parseExpression, UTC } from "./schedule-adherence";

import type { Parsed, ParsedExpression, Zone } from "./schedule-adherence";

// The zone of the machine the tests run on is one no row below is computed in, fourteen hours east of
// UTC: an instant computed in it would fail every row with a wall clock. The computation never reads it.
process.env.TZ = "Pacific/Kiritimati";

function accepted(text: string): ParsedExpression {
  const parsed = parseExpression(text);

  if (parsed.kind === "refused") throw new Error(`${text} refused: ${parsed.reason}`);
  return parsed;
}

function refused(text: string): string {
  const parsed = parseExpression(text);

  return parsed.kind === "refused" ? parsed.reason : `accepted as ${parsed.kind}`;
}

// The next instant of an expression after an instant, in the zone the expression names or in the given
// one, written in UTC; or the kind of the result when it is no instant, with its reason or its name.
function runAfter(text: string, from: string, zone: Zone = UTC): string {
  const parsed = accepted(text);
  const next = nextInstant(parsed, Date.parse(from), expressionZone(parsed) ?? zone);

  if (next.kind === "instant") return new Date(next.at).toISOString();
  return `${next.kind}: ${next.kind === "none" ? next.reason : next.name}`;
}

const utc = (text: string) => new Date(Date.parse(text)).toISOString();

type Row = [expression: string, from: string, expected: string, source: string, earlier?: string];

// The rows of the table name the file and the line of the tests of go-cron v0.15.0 they are taken from,
// or the test or the document of Velero v1.18.4; a row with a fifth column is one the library of v1.18.2
// read otherwise, as the facts of the parser of SPEC-0013 record. The tests of the module write most rows
// with a field of seconds first, for a parser of six fields: the rows here drop it, since ParseStandard
// reads five, and the instants of 2012 are the ones of the module.
const FIVE_FIELDS: Row[] = [
  ["0/15 * * * *", "2012-07-09T14:45:00Z", "2012-07-09T15:00:00Z", "spec_test.go L86"],
  ["0/15 * * * *", "2012-07-09T14:59:59Z", "2012-07-09T15:00:00Z", "spec_test.go L88"],
  ["5/15 * * * *", "2012-07-09T15:05:00Z", "2012-07-09T15:20:00Z", "spec_test.go L24-L26"],
  ["20-35/15 * * * *", "2012-07-09T15:45:00Z", "2012-07-09T16:20:00Z", "spec_test.go L91"],
  ["*/15 * * * *", "2012-07-09T23:46:00Z", "2012-07-10T00:00:00Z", "spec_test.go L94"],
  ["20-35/15 * * * *", "2012-07-09T23:45:00Z", "2012-07-10T00:20:00Z", "spec_test.go L95"],
  ["20-35/15 1/2 * * *", "2012-07-09T23:35:51Z", "2012-07-10T01:20:00Z", "spec_test.go L97"],
  ["20-35/15 10-12 * * *", "2012-07-09T23:35:51Z", "2012-07-10T10:20:00Z", "spec_test.go L98"],
  ["20-35/15 1/2 */2 * *", "2012-07-09T23:35:51Z", "2012-07-11T01:20:00Z", "spec_test.go L100"],
  ["20-35/15 * 9-20 * *", "2012-07-09T23:35:51Z", "2012-07-10T00:20:00Z", "spec_test.go L101"],
  ["20-35/15 * 9-20 Jul *", "2012-07-09T23:35:51Z", "2012-07-10T00:20:00Z", "spec_test.go L102"],
  ["0 0 9 Apr-Oct ?", "2012-07-09T23:35:00Z", "2012-08-09T00:00:00Z", "spec_test.go L105"],
  ["0 0 * Feb Mon", "2012-07-09T23:35:00Z", "2013-02-04T00:00:00Z", "spec_test.go L110"],
  ["0 0 * Feb Mon/2", "2012-07-09T23:35:00Z", "2013-02-01T00:00:00Z", "spec_test.go L111"],
  ["* * * * *", "2012-12-31T23:59:45Z", "2013-01-01T00:00:00Z", "spec_test.go L114"],
  ["0 0 29 Feb ?", "2012-07-09T23:35:00Z", "2016-02-29T00:00:00Z", "spec_test.go L117"],
  ["0/15 * * Jul *", "2012-07-15T14:50:00Z", "2012-07-15T15:00:00Z", "spec_test.go L29"],
  ["30 08 ? Jul Sun", "2012-07-14T23:00:00Z", "2012-07-15T08:30:00Z", "spec_test.go L33"],
  ["30 08 15 Jul ?", "2012-07-14T23:00:00Z", "2012-07-15T08:30:00Z", "spec_test.go L34"],
  ["0 9 * * *", "2017-08-10T12:27:00Z", "2017-08-11T09:00:00Z", "schedule_controller_test.go L346-L356"],
  ["0 0 * * Mon", "2012-08-05T00:00:00Z", "2012-08-06T00:00:00Z", "spec_test.go L683"],
  ["0 0 15 * *", "2012-08-01T00:00:00Z", "2012-08-15T00:00:00Z", "spec_test.go L685"],
];

const BOTH_DAY_FIELDS: Row[] = [
  ["0 0 */5 Apr,Aug,Oct Mon", "2012-07-09T23:35:00Z", "2012-08-06T00:00:00Z", "spec_test.go L106", "either day"],
  ["0 0 */5 Oct Mon", "2012-07-09T23:35:00Z", "2012-10-01T00:00:00Z", "spec_test.go L107", "either day"],
  ["0 0 25-31 * Fri", "2012-08-01T00:00:00Z", "2012-08-31T00:00:00Z", "spec_test.go L782-L787", "either day"],
  ["0 0 1-7 * Mon", "2012-08-01T00:00:00Z", "2012-08-06T00:00:00Z", "spec_test.go L788-L793", "either day"],
  ["0 0 13 * Fri", "2012-07-09T00:00:00Z", "2012-07-13T00:00:00Z", "spec_test.go L794-L799", "either day"],
  ["0 0 8-14 * Tue", "2012-08-01T00:00:00Z", "2012-08-14T00:00:00Z", "spec_test.go L800-L805", "either day"],
  ["* * 1,15 * Sun", "2012-07-14T23:59:00Z", "2012-07-15T00:00:00Z", "spec_test.go L51"],
  ["* * 1,15 * Sun", "2012-06-14T23:59:00Z", "2012-07-01T00:00:00Z", "spec_test.go L52", "the 15th of June"],
  [
    "0 3 1 * 1",
    "2026-01-01T00:00:00Z",
    "2026-06-01T03:00:00Z",
    "SPEC-0013, the facts of the parser",
    "2026-01-01T03:00:00Z",
  ],
];

const NAMES_AND_WRAPS: Row[] = [
  [
    "0 0 * * 7",
    "2024-01-06T00:00:00Z",
    "2024-01-07T00:00:00Z",
    "parser_test.go L1341-L1350",
    "refused: 7 above the maximum",
  ],
  ["0 0 * * 0", "2024-01-06T00:00:00Z", "2024-01-07T00:00:00Z", "parser_test.go L1343"],
  ["0 0 * * 5-7", "2024-01-04T00:00:00Z", "2024-01-05T00:00:00Z", "parser_test.go L1376-L1379", "refused"],
  ["0 0 * * 1,3,7", "2024-01-05T00:00:00Z", "2024-01-07T00:00:00Z", "parser_test.go L1313", "refused"],
  [
    "0 22-2 * * *",
    "2025-01-01T21:00:00Z",
    "2025-01-01T22:00:00Z",
    "parser_test.go L233-L265",
    "refused: a range beyond its end",
  ],
  ["0 22-2 * * *", "2025-01-01T22:00:00Z", "2025-01-01T23:00:00Z", "parser_test.go L257-L258", "refused"],
  ["0 22-2 * * *", "2025-01-01T23:00:00Z", "2025-01-02T00:00:00Z", "parser_test.go L257-L258", "refused"],
  ["0 22-2 * * *", "2025-01-02T00:00:00Z", "2025-01-02T01:00:00Z", "parser_test.go L257-L258", "refused"],
  ["0 22-2 * * *", "2025-01-02T01:00:00Z", "2025-01-02T02:00:00Z", "parser_test.go L257-L258", "refused"],
  ["0 0 1 11-2 *", "2025-10-15T00:00:00Z", "2025-11-01T00:00:00Z", "parser_test.go L267-L282", "refused"],
  ["0 0 1 11-2 *", "2025-11-01T00:00:00Z", "2025-12-01T00:00:00Z", "parser_test.go L284-L298", "refused"],
  ["0 0 1 11-2 *", "2025-12-01T00:00:00Z", "2026-01-01T00:00:00Z", "parser_test.go L284-L298", "refused"],
  ["0 0 1 11-2 *", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z", "parser_test.go L284-L298", "refused"],
  ["0 0 1 NOV-FEB *", "2025-10-15T00:00:00Z", "2025-11-01T00:00:00Z", "parser_test.go L204, L269", "refused"],
  ["0 0 * * FRI-MON", "2025-01-02T00:00:00Z", "2025-01-03T00:00:00Z", "parser_test.go L301-L314", "refused"],
  ["0 0 * * FRI-MON", "2025-01-03T00:00:00Z", "2025-01-04T00:00:00Z", "parser_test.go L323-L337", "refused"],
  ["0 0 * * FRI-MON", "2025-01-04T00:00:00Z", "2025-01-05T00:00:00Z", "parser_test.go L323-L337", "refused"],
  ["0 0 * * FRI-MON", "2025-01-05T00:00:00Z", "2025-01-06T00:00:00Z", "parser_test.go L323-L337", "refused"],
  ["0 0 28-3 * *", "2025-02-27T00:00:00Z", "2025-02-28T00:00:00Z", "parser_test.go L340-L354", "refused"],
  ["0 0 28-3 * *", "2025-02-28T00:00:00Z", "2025-03-01T00:00:00Z", "parser_test.go L357-L362", "refused"],
  ["0 0 28-3 * *", "2025-03-01T00:00:00Z", "2025-03-02T00:00:00Z", "parser_test.go L364-L367", "refused"],
  ["0 0 28-3 * *", "2025-03-02T00:00:00Z", "2025-03-03T00:00:00Z", "parser_test.go L368-L372", "refused"],
];

const DESCRIPTORS: Row[] = [
  ["@hourly", "2012-07-09T15:04:00Z", "2012-07-09T16:00:00Z", "spec_test.go L39-L40"],
  ["@daily", "2012-07-09T15:00:00Z", "2012-07-10T00:00:00Z", "spec_test.go L41-L42"],
  ["@midnight", "2012-07-09T15:00:00Z", "2012-07-10T00:00:00Z", "parser_test.go L590, L1000-L1002"],
  ["@weekly", "2012-07-08T00:00:00Z", "2012-07-15T00:00:00Z", "spec_test.go L43-L45"],
  ["@monthly", "2012-07-08T00:00:00Z", "2012-08-01T00:00:00Z", "spec_test.go L46-L47"],
  ["@yearly", "2012-07-09T00:00:00Z", "2013-01-01T00:00:00Z", "parser_test.go L593, L1004-L1015"],
  ["@annually", "2012-07-09T00:00:00Z", "2013-01-01T00:00:00Z", "parser_test.go L594, L1004-L1015"],
  ["@every 5m", "2017-01-01T12:00:00Z", "2017-01-01T12:05:00Z", "schedule_controller_test.go L261-L266"],
  ["@every 15m", "2012-07-09T14:45:00.005Z", "2012-07-09T15:00:00Z", "constantdelay_test.go L44"],
  ["@every 15m0.00000005s", "2012-07-09T14:45:00Z", "2012-07-09T15:00:00Z", "constantdelay_test.go L18, L38"],
  ["@every 5.5s", "2024-01-01T12:00:00.500Z", "2024-01-01T12:00:05Z", "constantdelay_test.go L104-L107, L351-L359"],
  [
    "@every 1h30m0.5s",
    "2026-10-14T00:00:00Z",
    "2026-10-14T01:30:00Z",
    "parser.go L1525-L1533, constantdelay.go L47-L50",
  ],
  ["@every 1s", "2026-10-14T00:00:00.999Z", "2026-10-14T00:00:01Z", "parser_test.go L588"],
  ["@every 8760h", "2026-10-14T00:00:00Z", "2027-10-14T00:00:00Z", "SPEC-0013, the real schedule of the fixtures"],
  ["TZ=Asia/Tokyo @every 1h", "2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z", "constantdelay.go L63-L74"],
];

// The changes of daylight saving time of 2026: in New York on March 8 at 07:00Z, when 02:00 becomes
// 03:00, and on November 1 at 06:00Z, when 02:00 becomes 01:00; in Rome on March 29 at 01:00Z, when 02:00
// becomes 03:00, and on October 25 at 01:00Z, when 03:00 becomes 02:00. The rules are the ones the tests
// of the module prove on the changes of 2012 in New York, two of which are rows here as they are.
const ZONES: Row[] = [
  [
    "TZ=America/New_York 30 2 11 Mar ?",
    "2012-03-11T00:00:00-05:00",
    "2012-03-11T03:30:00-04:00",
    "spec_test.go L121",
    "not run that day",
  ],
  ["TZ=America/New_York 30 2 4 Nov ?", "2012-11-04T00:00:00-04:00", "2012-11-04T02:30:00-05:00", "spec_test.go L143"],
  [
    "TZ=America/New_York 30 2 * * *",
    "2026-03-08T00:00:00-05:00",
    "2026-03-08T03:30:00-04:00",
    "spec_test.go L121",
    "not run that day",
  ],
  ["TZ=America/New_York 0 * * * *", "2026-03-08T00:00:00-05:00", "2026-03-08T01:00:00-05:00", "spec_test.go L124"],
  ["TZ=America/New_York 0 * * * *", "2026-03-08T01:00:00-05:00", "2026-03-08T03:00:00-04:00", "spec_test.go L125"],
  ["TZ=America/New_York 0 * * * *", "2026-03-08T03:00:00-04:00", "2026-03-08T04:00:00-04:00", "spec_test.go L126"],
  ["CRON_TZ=America/New_York 0 * * * *", "2026-03-08T01:00:00-05:00", "2026-03-08T03:00:00-04:00", "spec_test.go L131"],
  ["TZ=America/New_York 0 1 * * *", "2026-03-08T00:00:00-05:00", "2026-03-08T01:00:00-05:00", "spec_test.go L136"],
  ["TZ=America/New_York 0 1 * * *", "2026-03-08T01:00:00-05:00", "2026-03-09T01:00:00-04:00", "spec_test.go L137"],
  [
    "TZ=America/New_York 0 2 * * *",
    "2026-03-08T00:00:00-05:00",
    "2026-03-08T03:00:00-04:00",
    "spec_test.go L140",
    "not run that day",
  ],
  ["TZ=America/New_York 30 2 * * *", "2026-11-01T00:00:00-04:00", "2026-11-01T02:30:00-05:00", "spec_test.go L143"],
  ["TZ=America/New_York 30 1 * * *", "2026-11-01T01:45:00-04:00", "2026-11-01T01:30:00-05:00", "spec_test.go L144"],
  ["TZ=America/New_York 0 * * * *", "2026-11-01T00:00:00-04:00", "2026-11-01T01:00:00-04:00", "spec_test.go L147"],
  ["TZ=America/New_York 0 * * * *", "2026-11-01T01:00:00-04:00", "2026-11-01T01:00:00-05:00", "spec_test.go L148"],
  ["TZ=America/New_York 0 * * * *", "2026-11-01T01:00:00-05:00", "2026-11-01T02:00:00-05:00", "spec_test.go L149"],
  ["TZ=America/New_York 0 1 * * *", "2026-11-01T00:00:00-04:00", "2026-11-01T01:00:00-04:00", "spec_test.go L153"],
  ["TZ=America/New_York 0 1 * * *", "2026-11-01T01:00:00-04:00", "2026-11-01T01:00:00-05:00", "spec_test.go L154"],
  ["TZ=America/New_York 0 1 * * *", "2026-11-01T01:00:00-05:00", "2026-11-02T01:00:00-05:00", "spec_test.go L155"],
  ["TZ=America/New_York 0 2 * * *", "2026-11-01T00:00:00-04:00", "2026-11-01T02:00:00-05:00", "spec_test.go L158"],
  ["TZ=America/New_York 0 2 * * *", "2026-11-01T02:00:00-05:00", "2026-11-02T02:00:00-05:00", "spec_test.go L159"],
  ["TZ=America/New_York 0 3 * * *", "2026-11-01T00:00:00-04:00", "2026-11-01T03:00:00-05:00", "spec_test.go L162"],
  [
    "CRON_TZ=Europe/Rome 30 2 * * *",
    "2026-03-29T00:00:00+01:00",
    "2026-03-29T03:30:00+02:00",
    "spec_test.go L121",
    "not run that day",
  ],
  ["CRON_TZ=Europe/Rome 0 * * * *", "2026-03-29T01:00:00+01:00", "2026-03-29T03:00:00+02:00", "spec_test.go L125"],
  ["CRON_TZ=Europe/Rome 0 * * * *", "2026-03-29T03:00:00+02:00", "2026-03-29T04:00:00+02:00", "spec_test.go L126"],
  [
    "CRON_TZ=Europe/Rome 0 2 * * *",
    "2026-03-29T00:00:00+01:00",
    "2026-03-29T03:00:00+02:00",
    "spec_test.go L140",
    "not run that day",
  ],
  ["CRON_TZ=Europe/Rome 0 2 * * *", "2026-10-25T00:00:00+02:00", "2026-10-25T02:00:00+02:00", "spec_test.go L153"],
  ["CRON_TZ=Europe/Rome 0 2 * * *", "2026-10-25T02:00:00+02:00", "2026-10-25T02:00:00+01:00", "spec_test.go L154"],
  ["CRON_TZ=Europe/Rome 0 2 * * *", "2026-10-25T02:00:00+01:00", "2026-10-26T02:00:00+01:00", "spec_test.go L155"],
  ["CRON_TZ=Europe/Rome 0 * * * *", "2026-10-25T01:00:00+02:00", "2026-10-25T02:00:00+02:00", "spec_test.go L147"],
  ["CRON_TZ=Europe/Rome 0 * * * *", "2026-10-25T02:00:00+02:00", "2026-10-25T02:00:00+01:00", "spec_test.go L148"],
  ["CRON_TZ=Europe/Rome 0 * * * *", "2026-10-25T02:00:00+01:00", "2026-10-25T03:00:00+01:00", "spec_test.go L149"],
  ["CRON_TZ=Europe/Rome 30 2 * * *", "2026-10-25T02:45:00+02:00", "2026-10-25T02:30:00+01:00", "spec_test.go L144"],
  ["CRON_TZ=Europe/Rome 0 3 * * *", "2026-10-25T00:00:00+02:00", "2026-10-25T03:00:00+01:00", "spec_test.go L162"],
  ["TZ=UTC 0 2 * * *", "2026-03-29T00:00:00Z", "2026-03-29T02:00:00Z", "parser_test.go L1108"],
  ["CRON_TZ=UTC  5 * * * *", "2026-01-01T00:00:00Z", "2026-01-01T00:05:00Z", "parser_test.go L585"],
  ["TZ=UTC  @midnight", "2012-07-09T15:00:00Z", "2012-07-10T00:00:00Z", "parser_test.go L591"],
  ["TZ=Asia/Tokyo @midnight", "2012-07-09T15:00:00Z", "2012-07-11T00:00:00+09:00", "parser_test.go L592"],
  ['TZ="America/New_York" 0 5 * * *', "2026-01-01T00:00:00-05:00", "2026-01-01T05:00:00-05:00", "parser_test.go L1168"],
  ["CRON_TZ='Asia/Tokyo' 30 4 * * *", "2026-01-01T00:00:00Z", "2026-01-02T04:30:00+09:00", "parser_test.go L1174"],
  ["TZ=Etc/GMT+5 * * * * *", "2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z", "parser_test.go L1110"],
  ["TZ=America/Sao_Paulo 0 9 10 * ?", "2018-10-17T05:00:00-04:00", "2018-11-10T06:00:00-05:00", "spec_test.go L193"],
  ["TZ=America/Sao_Paulo 0 9 22 * ?", "2018-02-14T05:00:00-05:00", "2018-02-22T07:00:00-05:00", "spec_test.go L194"],
  // Santiago moves its clock at midnight: on 2026-09-06, 00:00 becomes 01:00. The hour loop of the library wraps
  // to the day only when it reaches hour 0, so it runs past the day the field names into the next one without
  // checking the day again; and the midnight that does not exist is not moved, since the jump is of one hour.
  ["TZ=America/Santiago 0 1 5 9 *", "2026-09-05T12:00:00-04:00", "2026-09-06T01:00:00-03:00", "spec.go L451-L453"],
  [
    "TZ=America/Santiago 0 0 * * *",
    "2026-09-05T12:00:00-04:00",
    "2026-09-07T00:00:00-03:00",
    "spec.go L326-L334, L451-L453",
  ],
];

const NO_INSTANT: Row[] = [
  ["0 0 30 2 *", "2024-01-01T00:00:00Z", "none: beyond-five-years", "parser_test.go L1223-L1236"],
  ["0 0 30 Feb ?", "2012-07-09T23:35:00Z", "none: beyond-five-years", "spec_test.go L185"],
  ["0 0 31 Apr ?", "2012-07-09T23:35:00Z", "none: beyond-five-years", "spec_test.go L186"],
  [", * * * *", "2026-01-01T00:00:00Z", "none: beyond-five-years", "parser.go L845-L856, spec.go L383-L388"],
  ["@triggered", "2026-01-01T00:00:00Z", "none: no-instant", "triggered_test.go L45-L55", "unrecognized descriptor"],
  ["@manual", "2026-01-01T00:00:00Z", "none: no-instant", "triggered.go L21-L24", "unrecognized descriptor"],
  ["@none", "2026-01-01T00:00:00Z", "none: no-instant", "triggered.go L21-L24", "unrecognized descriptor"],
  ["TZ=Mars/Olympus 0 3 * * *", "2026-01-01T00:00:00Z", "zone-not-known: Mars/Olympus", "parser.go L355-L358"],
];

const SIXTY_FIVE = "A".repeat(65);

// The words the controller writes into the validation errors of the schedule, word for word.
const REFUSED: [expression: string, reason: string, source: string, earlier?: string][] = [
  ["", "Schedule must be a non-empty valid Cron expression", "schedule_controller.go L179-L181, its test L73"],
  [
    "TZ= * * * * *",
    'invalid schedule: invalid timezone "": empty timezone string',
    "parser_test.go L1127",
    "read as UTC",
  ],
  [
    'TZ="" * * * * *',
    'invalid schedule: invalid timezone "": empty timezone string',
    "parser_test.go L1181",
    "refused: an unknown zone",
  ],
  [
    "TZ=../../../etc/passwd * * * * *",
    `invalid schedule: invalid timezone "../../../etc/passwd": invalid character '.' at position 0 in timezone`,
    "parser_test.go L1115",
    "unknown time zone",
  ],
  [
    "TZ=UTC;evil * * * * *",
    `invalid schedule: invalid timezone "UTC;evil": invalid character ';' at position 3 in timezone`,
    "parser_test.go L1122",
    "unknown time zone",
  ],
  [
    `TZ="UTC' * * * * *`,
    `invalid schedule: invalid timezone "\\"UTC'": invalid character '"' at position 0 in timezone`,
    "parser_test.go L1177",
    "unknown time zone",
  ],
  [
    "TZ=Europe/Rome\t0 3 * * *",
    `invalid schedule: invalid timezone "Europe/Rome\\t0": invalid character '\\t' at position 11 in timezone`,
    "parser.go L1406-L1409",
    "unknown time zone",
  ],
  [
    `TZ=${SIXTY_FIVE} * * * * *`,
    `invalid schedule: invalid timezone "${SIXTY_FIVE}": timezone string too long (max 64 chars)`,
    "parser_test.go L1130",
    "unknown time zone",
  ],
  [
    "TZ=America/New_York",
    'invalid schedule: missing fields after timezone in spec "TZ=America/New_York"',
    "parser_test.go L1049",
    "a panic",
  ],
  ["TZ=", 'invalid schedule: missing fields after timezone in spec "TZ="', "parser_test.go L1034", "a panic"],
  ["TZ=UTC   ", 'invalid schedule: missing fields after timezone "UTC"', "parser_test.go L1044", "refused: no field"],
  [
    "*/60 * * * *",
    'invalid schedule: step (60) must be less than range size (60): "*/60"',
    "parser_test.go L53, CHANGELOG.md L578",
    "accepted",
  ],
  [
    "0-5/6 * * * *",
    'invalid schedule: step (6) must be less than range size (6): "0-5/6"',
    "parser_test.go L51",
    "accepted",
  ],
  [
    "@every 500ms",
    'invalid schedule: @every duration must be at least 1s: "@every 500ms"',
    "parser_test.go L533",
    "rounded up to a second",
  ],
  [
    "@every 0.5s",
    'invalid schedule: @every duration must be at least 1s: "@every 0.5s"',
    "parser_test.go L533-L536",
    "rounded up to a second",
  ],
  [
    "@every Xm",
    'invalid schedule: failed to parse duration "@every Xm": time: invalid duration "Xm"',
    "parser_test.go L528",
  ],
  [
    "@every 5",
    'invalid schedule: failed to parse duration "@every 5": time: missing unit in duration "5"',
    "parser.go L1526-L1528",
  ],
  [
    "@every 5d",
    'invalid schedule: failed to parse duration "@every 5d": time: unknown unit "d" in duration "5d"',
    "parser.go L1526-L1528",
  ],
  // The number Go keeps a duration in has 63 bits and a sign: this fraction brings it to exactly 2 to the 63rd.
  [
    "@every 2562047h47m16.854775808s",
    'invalid schedule: failed to parse duration "@every 2562047h47m16.854775808s": time: invalid duration "2562047h47m16.854775808s"',
    "parser.go L1526-L1528, the last check of time.ParseDuration",
  ],
  ["@unrecognized", 'invalid schedule: unrecognized descriptor: "@unrecognized"', "parser_test.go L529"],
  ["*".repeat(1025), "invalid schedule: spec too long: 1025 > 1024", "parser_test.go L558-L566", "no limit"],
  ["* * * *", "invalid schedule: expected exactly 5 fields, found 4: [* * * *]", "parser_test.go L772-L773"],
  [
    "5 j * * *",
    'invalid schedule: failed to parse int from "j": strconv.Atoi: parsing "j": invalid syntax',
    "parser_test.go L768-L769",
  ],
  [
    "0 0 * * XYZ",
    'invalid schedule: failed to parse int from "XYZ": strconv.Atoi: parsing "XYZ": invalid syntax',
    "spec_test.go L221",
  ],
  ["60 0 * * *", 'invalid schedule: end of range (60) above maximum (59): "60"', "spec_test.go L219"],
  ["0 0 0 * *", 'invalid schedule: beginning of range (0) below minimum (1): "0"', "parser_test.go L44"],
  ["15/0 * * * *", 'invalid schedule: step of range must be a positive number: "15/0"', "spec_test.go L313"],
  ["*/-12 * * * *", 'invalid schedule: negative number (-12) not allowed: "-12"', "parser_test.go L42"],
  ["5--5 * * * *", 'invalid schedule: too many hyphens: "5--5"', "parser_test.go L39"],
  ["*//2 * * * *", 'invalid schedule: too many slashes: "*//2"', "parser_test.go L43"],
  [
    "0 0 L * *",
    "invalid schedule: extended day-of-month syntax requires DomL option (for L, L-n) or DomW option (for nW, LW) to be enabled",
    "parser_test.go L1809, parser.go L539",
  ],
  [
    "0 0 * * FRI#3",
    "invalid schedule: #n/#L syntax requires DowNth or DowLast option to be enabled",
    "parser_test.go L1807, parser.go L557",
  ],
  ["H * * * *", "invalid schedule: h expressions require hash option to be enabled", "parser.go L457-L460"],
  // The name is read up to the first space: the server refuses what is left as a zone it does not know, which
  // this version cannot know of the server, and reads the rest of the text as one field too many.
  [
    "TZ=America/New York 0 3 * * *",
    "invalid schedule: expected exactly 5 fields, found 6: [York 0 3 * * *]",
    "parser_test.go L1120",
  ],
];

describe("ADH-01: the grammar of the parser of the reviewed release", () => {
  it("runs the tests in a zone fourteen hours east of UTC, which no row is computed in", () => {
    expect(new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset()).toBe(-840);
    expect(runAfter("0 3 * * *", "2026-06-01T00:00:00Z")).toBe(utc("2026-06-01T03:00:00Z"));
  });

  describe.each([
    ["the five fields, with lists, ranges, steps, N/step, names and ?", FIVE_FIELDS],
    ["a day of the month and a day of the week that are both restricted, which must both match", BOTH_DAY_FIELDS],
    ["the names, Sunday as 7 and the ranges that wrap", NAMES_AND_WRAPS],
    ["the descriptors", DESCRIPTORS],
    ["the zones and the changes of daylight saving time", ZONES],
  ])("%s", (_, rows) => {
    it.each(rows)("%s after %s is %s (%s)", (expression, from, expected) => {
      expect(runAfter(expression, from)).toBe(utc(expected));
    });
  });

  it.each(NO_INSTANT)("%s after %s has no instant: %s (%s)", (expression, from, expected) => {
    expect(runAfter(expression, from)).toBe(expected);
  });

  it.each(REFUSED)("refuses %j with the words the controller writes (%s)", (expression, reason) => {
    expect(refused(expression)).toBe(reason);
  });

  it("names the source of every row, and the rows the library of v1.18.2 read otherwise", () => {
    const rows = [...FIVE_FIELDS, ...BOTH_DAY_FIELDS, ...NAMES_AND_WRAPS, ...DESCRIPTORS, ...ZONES, ...NO_INSTANT];

    expect(
      rows.every((row) =>
        /^(spec_test|parser_test|constantdelay_test|triggered_test|schedule_controller_test)\.go L\d|^(parser|spec|triggered|constantdelay)\.go L\d|^SPEC-0013/.test(
          row[3],
        ),
      ),
    ).toBe(true);
    expect(REFUSED.every((row) => /\.go L\d|CHANGELOG/.test(row[2]))).toBe(true);
    // The rules that changed: the AND of the day fields, Sunday as 7, the wrapping ranges, the skipped
    // hour, the three descriptors without an instant, the empty name, the prefix with nothing after it,
    // the step equal to its range, @every below a second, the limit of the length.
    expect(rows.filter((row) => row[4] !== undefined).length).toBeGreaterThanOrEqual(30);
    expect(REFUSED.filter((row) => row[3] !== undefined).length).toBeGreaterThanOrEqual(12);
  });

  it("reads an expression of 1,024 characters for its fields, not for its length", () => {
    expect(refused("*".repeat(1024))).toMatch(/^invalid schedule: expected exactly 5 fields, found 1: \[\*+\]$/);
    expect(refused("*".repeat(1024))).not.toContain("too long");
  });

  it("gives the fields of an expression as sets, and the kind of what it read", () => {
    const parsed = accepted("5 * * * *");

    expect(parsed.kind).toBe("fields");
    if (parsed.kind !== "fields") return;
    expect([...parsed.fields.minutes]).toEqual([5]);
    expect(parsed.fields.hours.size).toBe(24);
    expect(parsed.fields.days.size).toBe(31);
    expect(parsed.fields.months.size).toBe(12);
    expect([...parsed.fields.weekdays].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(parsed.zone).toEqual({ of: "none" });
    expect(parseExpression("@weekly")).toMatchObject({ kind: "calendar", descriptor: "@weekly" });
    expect(parseExpression("@every 1h30m0.5s")).toEqual({ kind: "every", zone: { of: "none" }, seconds: 5400 });
    expect(parseExpression("@triggered")).toEqual({
      kind: "no-instant",
      zone: { of: "none" },
      descriptor: "@triggered",
    });
    const sunday = accepted("0 0 * * 7");

    if (sunday.kind === "fields") expect([...sunday.fields.weekdays]).toEqual([0]);
    const wrapped = accepted("0 22-2 * * *");

    if (wrapped.kind === "fields") expect([...wrapped.fields.hours].sort((a, b) => a - b)).toEqual([0, 1, 2, 22, 23]);
    const stepped = accepted("70/5 * * * *");

    // A value above the maximum with a step is read by the parser, which counts the size of the range in
    // an unsigned integer: the values it gives are the ones of the library (parser.go L1158-L1183).
    if (stepped.kind === "fields")
      expect([...stepped.fields.minutes]).toEqual([10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  });

  it("keeps a parsed expression for the text of the expression, and refuses what is not a text as empty", () => {
    expect(parseExpression("0 3 * * *")).toBe(parseExpression("0 3 * * *"));
    expect(parseExpression("TZ=Europe/Rome 0 3 * * *")).toBe(parseExpression("TZ=Europe/Rome 0 3 * * *"));
    expect(parseExpression(undefined)).toEqual({
      kind: "refused",
      reason: "Schedule must be a non-empty valid Cron expression",
    });
    expect(parseExpression(null)).toEqual(parseExpression(""));
    expect(parseExpression(7)).toEqual(parseExpression(""));
  });
});

// A parsed expression a view would hold is plain data: nothing in it is a function or a date.
it("gives plain values", () => {
  const values: Parsed[] = [
    parseExpression("0 3 * * *"),
    parseExpression("@every 6h"),
    parseExpression("@none"),
    parseExpression(""),
  ];

  for (const value of values)
    expect(JSON.stringify(value, (_key, item) => (item instanceof Set ? [...item] : item))).not.toMatch(
      /NaN|undefined|function/,
    );
});
