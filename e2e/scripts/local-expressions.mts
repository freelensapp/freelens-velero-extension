// The expressions of the schedules of mixed kinds that two places are made of: the measure of the adherence in the
// unit run, which computes the signals of a thousand of them, and the fixtures of the budget of the adherence, which
// place three hundred in the test environment. Each is named by its index, and is of its own text but for the
// descriptors and the one with no instant: the minute and the hour of a five-field expression are the ones of the
// index, and so is the interval of an @every one. A tenth of them name a zone east of UTC, a tenth a zone west of it,
// a tenth is a zone east of UTC again, a tenth a calendar descriptor, and one in a hundred has no instant, which the
// controller submits at every look.
const DESCRIPTORS = ["@hourly", "@daily", "@weekly", "@monthly", "@yearly", "@midnight", "@annually"];

export function mixedExpression(index: number): string {
  const minute = index % 60;
  const hour = Math.floor(index / 60) % 24;

  switch (index % 10) {
    case 0:
      return `@every ${(index % 9) + 1}m${index % 59}s`;
    case 1:
      return `@every ${index + 1}h`;
    case 2:
      return `${minute} ${hour} * * *`;
    case 3:
      return `TZ=Europe/Rome ${minute} ${hour} * * *`;
    case 4:
      return `CRON_TZ=America/New_York ${minute} ${hour} * * 1-5`;
    case 5:
      return `${minute % 30}/30 ${hour} * * ${index % 7}`;
    case 6:
      return `${minute} ${hour} 1,15 * *`;
    case 7:
      return DESCRIPTORS[index % DESCRIPTORS.length];
    case 8:
      return `TZ=Asia/Tokyo ${minute} ${hour} * * *`;
    default:
      return index % 100 === 99 ? "0 0 30 2 *" : `${minute} ${hour} * * 0`;
  }
}
