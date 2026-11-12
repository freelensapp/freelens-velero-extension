// A label selector as the operator types it in the form of the template (SPEC-0016, the form), read as the parser of
// Kubernetes of the reviewed release reads one, `labels.Parse` of apimachinery v0.33.12, and written as
// `metav1.ParseToLabelSelector` writes it: `matchLabels` and `matchExpressions`, each requirement by its key, its values
// sorted. The checks of the names are the ones of `k8s.io/apimachinery/pkg/util/validation`, with their words.

// The parts of a selector the API takes, as Velero reads them in `labelSelector` and in each of `orLabelSelectors`.
export interface LabelSelector {
  matchLabels?: Record<string, string>;
  matchExpressions?: { key: string; operator: "In" | "NotIn" | "Exists" | "DoesNotExist"; values?: string[] }[];
}

const QUALIFIED_NAME = /^([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]$/;
const QUALIFIED_NAME_FORMAT = "([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]";
const QUALIFIED_NAME_WORDS =
  "must consist of alphanumeric characters, '-', '_' or '.', and must start and end with an alphanumeric character";
const LABEL_VALUE = /^(([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9])?$/;
const LABEL_VALUE_FORMAT = `(${QUALIFIED_NAME_FORMAT})?`;
const LABEL_VALUE_WORDS =
  "a valid label must be an empty string or consist of alphanumeric characters, '-', '_' or '.', and must start and end with an alphanumeric character";
const DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const DNS_LABEL_FORMAT = "[a-z0-9]([-a-z0-9]*[a-z0-9])?";
const DNS_LABEL_WORDS =
  "a lowercase RFC 1123 label must consist of lower case alphanumeric characters or '-', and must start and end with an alphanumeric character";
const DNS_SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const DNS_SUBDOMAIN_FORMAT = `${DNS_LABEL_FORMAT}(\\.${DNS_LABEL_FORMAT})*`;
const DNS_SUBDOMAIN_WORDS =
  "a lowercase RFC 1123 subdomain must consist of lower case alphanumeric characters, '-' or '.', and must start and end with an alphanumeric character";

// Go counts the bytes of a text.
function bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function longerThan(length: number): string {
  return `must be no more than ${length} characters`;
}

function regexWords(words: string, format: string, ...examples: string[]): string {
  if (examples.length === 0) return `${words} (regex used for validation is '${format}')`;
  // Each example is followed by a comma and a space, and joined to the next by " or ": two spaces before it.
  return `${words} (e.g. ${examples.map((example) => `'${example}', `).join(" or ")}regex used for validation is '${format}')`;
}

// `IsDNS1123Label`: what is wrong with a name that is one label, as the name of a namespace.
export function dnsLabelProblems(value: string): string[] {
  const problems: string[] = [];

  if (bytes(value) > 63) problems.push(longerThan(63));
  if (!DNS_LABEL.test(value)) {
    problems.push(
      DNS_SUBDOMAIN.test(value)
        ? "must not contain dots"
        : regexWords(DNS_LABEL_WORDS, DNS_LABEL_FORMAT, "my-name", "123-abc"),
    );
  }
  return problems;
}

// `IsDNS1123Subdomain`.
export function dnsSubdomainProblems(value: string): string[] {
  const problems: string[] = [];

  if (bytes(value) > 253) problems.push(longerThan(253));
  if (!DNS_SUBDOMAIN.test(value)) problems.push(regexWords(DNS_SUBDOMAIN_WORDS, DNS_SUBDOMAIN_FORMAT, "example.com"));
  return problems;
}

// `IsQualifiedName`: the key of a label, a name with an optional prefix that is a DNS subdomain.
export function qualifiedNameProblems(value: string): string[] {
  const problems: string[] = [];
  const parts = value.split("/");
  let name: string;

  if (parts.length === 1) name = parts[0];
  else if (parts.length === 2) {
    const prefix = parts[0];

    name = parts[1];
    if (prefix.length === 0) problems.push("prefix part must be non-empty");
    else problems.push(...dnsSubdomainProblems(prefix).map((problem) => `prefix part ${problem}`));
  } else {
    return [
      `a qualified name ${regexWords(QUALIFIED_NAME_WORDS, QUALIFIED_NAME_FORMAT, "MyName", "my.name", "123-abc")} with an optional DNS subdomain prefix and '/' (e.g. 'example.com/MyName')`,
    ];
  }
  if (name.length === 0) problems.push("name part must be non-empty");
  else if (bytes(name) > 63) problems.push(`name part ${longerThan(63)}`);
  if (!QUALIFIED_NAME.test(name))
    problems.push(
      `name part ${regexWords(QUALIFIED_NAME_WORDS, QUALIFIED_NAME_FORMAT, "MyName", "my.name", "123-abc")}`,
    );
  return problems;
}

// `IsValidLabelValue`.
export function labelValueProblems(value: string): string[] {
  const problems: string[] = [];

  if (bytes(value) > 63) problems.push(longerThan(63));
  if (!LABEL_VALUE.test(value))
    problems.push(regexWords(LABEL_VALUE_WORDS, LABEL_VALUE_FORMAT, "MyValue", "my_value", "12345"));
  return problems;
}

// The tokens of the lexer of the selector.
type Token = "error" | "end" | ")" | "," | "!" | "==" | "=" | ">" | "identifier" | "in" | "<" | "!=" | "notin" | "(";
const LITERALS: Record<string, Token> = {
  ")": ")",
  ",": ",",
  "!": "!",
  "==": "==",
  "=": "=",
  ">": ">",
  in: "in",
  "<": "<",
  "!=": "!=",
  notin: "notin",
  "(": "(",
};
type Scanned = { token: Token; literal: string };

const whitespace = (character: string) => [" ", "\t", "\r", "\n"].includes(character);
const special = (character: string) => ["=", "!", "(", ")", ",", ">", "<"].includes(character);

// A token of the table, and nothing an object inherits.
function literal(text: string): Token | undefined {
  return Object.hasOwn(LITERALS, text) ? LITERALS[text] : undefined;
}

// The lexer of `labels.Parse`, character by character: a NUL ends the selector, as the end of the text does.
function scan(selector: string): Scanned[] {
  const scanned: Scanned[] = [];
  let at = 0;
  const read = () => (at < selector.length && selector[at] !== "\u0000" ? selector[at++] : "");

  for (;;) {
    let character = read();

    while (character !== "" && whitespace(character)) character = read();
    if (character === "") {
      scanned.push({ token: "end", literal: "" });
      return scanned;
    }
    if (special(character)) {
      at -= 1;
      let buffer = "";
      let last: Scanned | undefined;

      for (;;) {
        const next = read();

        if (next === "") break;
        if (!special(next)) {
          at -= 1;
          break;
        }
        buffer += next;
        const token = literal(buffer);

        if (token) last = { token, literal: buffer };
        else if (last) {
          at -= 1;
          break;
        }
      }
      scanned.push(last ?? { token: "error", literal: `error expected: keyword found '${buffer}'` });
    } else {
      at -= 1;
      let buffer = "";

      for (;;) {
        const next = read();

        if (next === "") break;
        if (special(next) || whitespace(next)) {
          at -= 1;
          break;
        }
        buffer += next;
      }
      scanned.push({ token: literal(buffer) ?? "identifier", literal: buffer });
    }
  }
}

// A requirement as the parser makes it: its key, its operator and its values.
type Operator = "in" | "notin" | "=" | "==" | "!=" | "exists" | "!" | ">" | "<";
interface Requirement {
  key: string;
  operator: Operator;
  values: string[];
}

class SelectorError extends Error {}

// A value quoted as `%q` of Go quotes one that is printable: in double quotes, its quotes and backslashes escaped.
function quoted(value: string): string {
  return JSON.stringify(value);
}

// The errors of one requirement as the aggregate of apimachinery writes them: one alone as it is, and several, each
// once, in brackets, separated by commas.
function aggregate(problems: string[]): string {
  const distinct = [...new Set(problems)];

  return distinct.length === 1 ? distinct[0] : `[${distinct.join(", ")}]`;
}

// The parser of `labels.Parse`: requirements separated by commas, each `[!] KEY [operator values]`.
function parse(selector: string): Requirement[] {
  const items = scan(selector);
  let position = 0;
  // In the place of values, `in` and `notin` are identifiers.
  const asValue = (item: Scanned): Scanned =>
    item.token === "in" || item.token === "notin" ? { token: "identifier", literal: item.literal } : item;
  const lookahead = (values: boolean) => (values ? asValue(items[position]) : items[position]);
  const consume = (values: boolean) => {
    position += 1;
    return values ? asValue(items[position - 1]) : items[position - 1];
  };
  const keyProblem = (key: string) => {
    const problems = qualifiedNameProblems(key);

    if (problems.length > 0) throw new SelectorError(`Invalid value: ${quoted(key)}: ${problems.join("; ")}`);
  };
  const requirement = (): Requirement => {
    let negated = false;
    let item = consume(true);

    if (item.token === "!") {
      negated = true;
      item = consume(true);
    }
    if (item.token !== "identifier") throw new SelectorError(`found '${item.literal}', expected: identifier`);
    const key = item.literal;

    keyProblem(key);
    // A key after `!` takes no operator: what follows it is for the list of the requirements.
    if (negated) return { key, operator: "!", values: [] };
    const next = lookahead(true).token;

    if (next === "end" || next === ",") return { key, operator: "exists", values: [] };
    const operatorItem = consume(false);
    const operators: Partial<Record<Token, Operator>> = {
      in: "in",
      "=": "=",
      "==": "==",
      ">": ">",
      "<": "<",
      notin: "notin",
      "!=": "!=",
    };
    const operator = operators[operatorItem.token];

    if (!operator) throw new SelectorError(`found '${operatorItem.literal}', expected: in, notin, =, ==, !=, gt, lt`);
    const values = new Set<string>();

    if (operator === "in" || operator === "notin") {
      const open = consume(true);

      if (open.token !== "(") throw new SelectorError(`found '${open.literal}' expected: '('`);
      const first = lookahead(true);

      if (first.token === ")") {
        consume(true);
        values.add("");
      } else if (first.token === "identifier" || first.token === ",") {
        for (;;) {
          const value = consume(true);

          if (value.token === "identifier") {
            values.add(value.literal);
            const after = lookahead(true);

            if (after.token === ",") continue;
            if (after.token === ")") break;
            throw new SelectorError(`found '${after.literal}', expected: ',' or ')'`);
          }
          if (value.token === ",") {
            if (values.size === 0) values.add("");
            const after = lookahead(true);

            if (after.token === ")") {
              values.add("");
              break;
            }
            if (after.token === ",") {
              consume(true);
              values.add("");
            }
            continue;
          }
          throw new SelectorError(`found '${value.literal}', expected: ',', or identifier`);
        }
        if (consume(true).token !== ")") throw new SelectorError(`found '${first.literal}', expected: ')'`);
      } else throw new SelectorError(`found '${first.literal}', expected: ',', ')' or identifier`);
    } else {
      const value = lookahead(true);

      if (value.token === "end" || value.token === ",") values.add("");
      else {
        const taken = consume(true);

        if (taken.token !== "identifier") throw new SelectorError(`found '${taken.literal}', expected: identifier`);
        values.add(taken.literal);
      }
    }
    const sorted = [...values].sort();
    const problems: string[] = [];

    if ((operator === "in" || operator === "notin") && sorted.length === 0)
      problems.push("for 'in', 'notin' operators, values set can't be empty");
    // A comparison takes an integer, which the parser checks before the selector of the API refuses the comparison.
    if (operator === ">" || operator === "<") {
      for (const value of sorted) {
        if (!/^[+-]?\d+$/.test(value) || BigInt(value) > 2n ** 63n - 1n || BigInt(value) < -(2n ** 63n))
          problems.push(`Invalid value: "${value}": for 'Gt', 'Lt' operators, the value must be an integer`);
      }
    }
    for (const value of sorted) {
      const valueProblems = labelValueProblems(value);

      if (valueProblems.length > 0) problems.push(`Invalid value: ${quoted(value)}: ${valueProblems.join("; ")}`);
    }
    if (problems.length > 0) throw new SelectorError(aggregate(problems));
    return { key, operator, values: sorted };
  };
  const requirements: Requirement[] = [];

  for (;;) {
    const item = lookahead(true);

    if (item.token === "identifier" || item.token === "!") {
      try {
        requirements.push(requirement());
      } catch (error) {
        if (error instanceof SelectorError) throw new SelectorError(`unable to parse requirement: ${error.message}`);
        throw error;
      }
      const after = consume(true);

      if (after.token === "end") break;
      if (after.token !== ",") throw new SelectorError(`found '${after.literal}', expected: ',' or 'end of string'`);
      const next = lookahead(true);

      if (next.token !== "identifier" && next.token !== "!")
        throw new SelectorError(`found '${next.literal}', expected: identifier after ','`);
    } else if (item.token === "end") break;
    else throw new SelectorError(`found '${item.literal}', expected: !, identifier, or 'end of string'`);
  }
  // Sorted by key, as the parser of Kubernetes sorts them.
  return requirements.sort((one, other) => (one.key < other.key ? -1 : one.key > other.key ? 1 : 0));
}

// What the form makes of a selector it is given: the selector the API takes, or the words of what is wrong with the
// text. An equality writes a label of `matchLabels`, and `!=` writes `NotIn` with its one value, which selects the
// same objects: the parser of the command line of the release refuses `!=`. A key given two values with `=` selects
// nothing, and `matchLabels` would keep only the last: the form refuses it. `>` and `<` are not taken by a selector of
// the API.
export function readLabelSelector(text: string): { selector: LabelSelector } | { problem: string } {
  let requirements: Requirement[];

  try {
    requirements = parse(text);
  } catch (error) {
    if (error instanceof SelectorError) return { problem: error.message };
    throw error;
  }
  if (requirements.length === 0) return { problem: "The selector names no requirement." };
  // A key is any text of a label: none is a name an object inherits.
  const matchLabels = new Map<string, string>();
  const matchExpressions: NonNullable<LabelSelector["matchExpressions"]> = [];

  for (const { key, operator, values } of requirements) {
    if (operator === ">" || operator === "<")
      return { problem: `"${operator === ">" ? "gt" : "lt"}" isn't supported in label selectors` };
    if (operator === "=" || operator === "==") {
      if (matchLabels.has(key) && matchLabels.get(key) !== values[0])
        return {
          problem: `The key ${key} is given two values with =: a label has one value, and nothing is selected.`,
        };
      matchLabels.set(key, values[0]);
      continue;
    }
    const written =
      operator === "in"
        ? "In"
        : operator === "notin" || operator === "!="
          ? "NotIn"
          : operator === "exists"
            ? "Exists"
            : "DoesNotExist";

    matchExpressions.push({ key, operator: written, ...(values.length > 0 ? { values } : {}) });
  }
  const keys = [...matchLabels.keys()].sort();

  return {
    selector: {
      ...(keys.length > 0
        ? { matchLabels: Object.fromEntries(keys.map((key) => [key, matchLabels.get(key) ?? ""])) }
        : {}),
      ...(matchExpressions.length > 0 ? { matchExpressions } : {}),
    },
  };
}
