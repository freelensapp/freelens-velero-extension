// What the reviewed release reads as true in the text of a key of a configuration: it parses it as Go
// parses a boolean, and every other text is not true for it.
const READ_AS_TRUE = new Set(["1", "t", "T", "TRUE", "true", "True"]);

export function readsAsTrue(written: unknown): boolean {
  return typeof written === "string" && READ_AS_TRUE.has(written);
}
