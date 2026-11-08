import { describe, expect, it } from "vitest";
import goldens from "../../test/template-goldens.json";
import {
  dnsLabelProblems,
  dnsSubdomainProblems,
  labelValueProblems,
  qualifiedNameProblems,
  readLabelSelector,
} from "./label-selector";

describe("the names of Kubernetes, with the words of apimachinery", () => {
  it("reads a label of DNS, as the name of a namespace", () => {
    expect(dnsLabelProblems("shop-1")).toEqual([]);
    expect(dnsLabelProblems("a.b")).toEqual(["must not contain dots"]);
    expect(dnsLabelProblems("Shop")).toEqual([
      "a lowercase RFC 1123 label must consist of lower case alphanumeric characters or '-', and must start and end with an alphanumeric character (e.g. 'my-name',  or '123-abc', regex used for validation is '[a-z0-9]([-a-z0-9]*[a-z0-9])?')",
    ]);
    expect(dnsLabelProblems("a".repeat(64))).toEqual(["must be no more than 63 characters"]);
  });

  it("reads a subdomain of DNS, as the name of a location", () => {
    expect(dnsSubdomainProblems("default.aws-1")).toEqual([]);
    expect(dnsSubdomainProblems("a".repeat(254))).toEqual(["must be no more than 253 characters"]);
    expect(dnsSubdomainProblems("-a")).toEqual([
      "a lowercase RFC 1123 subdomain must consist of lower case alphanumeric characters, '-' or '.', and must start and end with an alphanumeric character (e.g. 'example.com', regex used for validation is '[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*')",
    ]);
  });

  it("reads the key of a label, with its prefix, and its value", () => {
    expect(qualifiedNameProblems("example.com/App_1")).toEqual([]);
    expect(qualifiedNameProblems("/app")).toEqual(["prefix part must be non-empty"]);
    expect(qualifiedNameProblems("example.com/")).toEqual([
      "name part must be non-empty",
      "name part must consist of alphanumeric characters, '-', '_' or '.', and must start and end with an alphanumeric character (e.g. 'MyName',  or 'my.name',  or '123-abc', regex used for validation is '([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]')",
    ]);
    expect(qualifiedNameProblems("a/b/c")[0]).toMatch(/^a qualified name must consist of alphanumeric characters/);
    expect(labelValueProblems("")).toEqual([]);
    expect(labelValueProblems("Web_1.2-3")).toEqual([]);
    expect(labelValueProblems("-web")).toHaveLength(1);
    expect(labelValueProblems("a".repeat(64))).toEqual(["must be no more than 63 characters"]);
  });
});

describe("a label selector as the form reads it", () => {
  it("writes the equalities as labels and the rest as expressions, each by its key, its values sorted", () => {
    expect(readLabelSelector("tier=front,app==web")).toEqual({
      selector: { matchLabels: { app: "web", tier: "front" } },
    });
    expect(readLabelSelector("z in (b,a), app, !legacy, a notin (d,c)")).toEqual({
      selector: {
        matchExpressions: [
          { key: "a", operator: "NotIn", values: ["c", "d"] },
          { key: "app", operator: "Exists" },
          { key: "legacy", operator: "DoesNotExist" },
          { key: "z", operator: "In", values: ["a", "b"] },
        ],
      },
    });
  });

  it("writes `!=` as NotIn with its one value, which selects the same objects", () => {
    expect(readLabelSelector("app!=web")).toEqual({
      selector: { matchExpressions: [{ key: "app", operator: "NotIn", values: ["web"] }] },
    });
  });

  it("takes the empty value as Kubernetes does, and in and notin as values", () => {
    expect(readLabelSelector("app=")).toEqual({ selector: { matchLabels: { app: "" } } });
    expect(readLabelSelector("app in ()")).toEqual({
      selector: { matchExpressions: [{ key: "app", operator: "In", values: [""] }] },
    });
    expect(readLabelSelector("app in (web,,api)")).toEqual({
      selector: { matchExpressions: [{ key: "app", operator: "In", values: ["", "api", "web"] }] },
    });
    expect(readLabelSelector("x in (in, notin)")).toEqual({
      selector: { matchExpressions: [{ key: "x", operator: "In", values: ["in", "notin"] }] },
    });
  });

  it("refuses what the parser of Kubernetes refuses, with its words", () => {
    expect(readLabelSelector("app=web,")).toEqual({ problem: "found '', expected: identifier after ','" });
    expect(readLabelSelector(",app")).toEqual({ problem: "found ',', expected: !, identifier, or 'end of string'" });
    expect(readLabelSelector("app in web")).toEqual({
      problem: "unable to parse requirement: found 'web' expected: '('",
    });
    expect(readLabelSelector("!app=web")).toEqual({ problem: "found '=', expected: ',' or 'end of string'" });
    expect(readLabelSelector("app notin")).toEqual({ problem: "unable to parse requirement: found '' expected: '('" });
    expect(readLabelSelector("=web")).toEqual({ problem: "found '=', expected: !, identifier, or 'end of string'" });
    expect(readLabelSelector("app=-web")).toEqual({
      problem: expect.stringMatching(/^unable to parse requirement: Invalid value: "-web": a valid label must be/),
    });
    expect(readLabelSelector("a/b/c=x")).toEqual({
      problem: expect.stringMatching(/^unable to parse requirement: Invalid value: "a\/b\/c": a qualified name/),
    });
  });

  it("refuses the comparisons, which a selector of the API does not take, a key with two values, and no requirement", () => {
    expect(readLabelSelector("app>1")).toEqual({ problem: `"gt" isn't supported in label selectors` });
    expect(readLabelSelector("app<1")).toEqual({ problem: `"lt" isn't supported in label selectors` });
    expect(readLabelSelector("app=web,app=api")).toEqual({
      problem: "The key app is given two values with =: a label has one value, and nothing is selected.",
    });
    expect(readLabelSelector("app=web,app=web")).toEqual({ selector: { matchLabels: { app: "web" } } });
    expect(readLabelSelector("   ")).toEqual({ problem: "The selector names no requirement." });
  });
});

describe("a label selector against what apimachinery made of it", () => {
  // What the form does otherwise, on purpose: `!=` written as NotIn, a key with two values refused, and a selector
  // with no requirement not set.
  const decided: Record<string, ReturnType<typeof readLabelSelector>> = {
    "app!=web": { selector: { matchExpressions: [{ key: "app", operator: "NotIn", values: ["web"] }] } },
    "app=web,app=api": {
      problem: "The key app is given two values with =: a label has one value, and nothing is selected.",
    },
    "": { problem: "The selector names no requirement." },
    "   ": { problem: "The selector names no requirement." },
  };

  it.each(goldens.selectors as { text: string; selector?: unknown; error?: string }[])(
    "reads $text as v0.33.12 did",
    ({ text, selector, error }) => {
      const read = readLabelSelector(text);

      if (text in decided) {
        expect(read).toEqual(decided[text]);
        return;
      }
      if (error === undefined) {
        expect(read).toEqual({ selector });
        return;
      }
      // The words of the parser, without what the command line adds before them and without the paths of the fields.
      expect(read).toEqual({
        problem: error
          .replace(/^couldn't parse the selector string ".*?": /, "")
          .replace(/(<nil>|values\[\d+\](\[[^\]]*\])?): /g, ""),
      });
    },
  );
});
