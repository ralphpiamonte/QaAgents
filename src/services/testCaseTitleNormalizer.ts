import type { QaOutput, StructuredTestCase } from "../schemas/qaOutput";

export function normalizeQaOutputTitles(output: QaOutput): QaOutput {
  return {
    ...output,
    detailedTestCases: output.detailedTestCases.map((testCase) => ({
      ...testCase,
      title: normalizeTestCaseTitle(testCase)
    }))
  };
}

function normalizeTestCaseTitle(testCase: StructuredTestCase): string {
  const compact = collapseWhitespace(testCase.title);
  if (!compact) {
    return "Verify that expected behavior is validated";
  }

  const body = stripVerifyPrefix(compact);
  const normalizedBody = applyGrammarFixes(body, testCase);
  return `Verify that ${normalizedBody}`;
}

function stripVerifyPrefix(title: string): string {
  return title.replace(/^verify that\s+/i, "").trim();
}

function applyGrammarFixes(body: string, testCase: StructuredTestCase): string {
  let value = body;

  value = value.replace(/\bdescription hyperlink\b/i, "the Description hyperlink");
  value = value.replace(/\bopens\s+PDP\b/i, "opens the PDP");
  value = value.replace(/\bfrom\s+API\b/i, "from the API");
  value = value.replace(/\bfinds\s+exact\s+match\b/i, "finds an exact match");
  value = value.replace(
    /\bprice updates from the API reflected as currently valid price\b/i,
    "price updates from the API are reflected as the currently valid price"
  );
  value = value.replace(
    /\bmanual VisionX price update and cross-location isolation\b/i,
    "manual VisionX price updates preserve cross-location isolation"
  );
  value = value.replace(
    /\b(?:UPC filter\s+)?boundary length\s+(\d+)\s+accepted;\s*(\d+)\s+handled\b/i,
    (_match, accepted: string, handled: string) =>
      `a UPC filter boundary length of ${accepted} is accepted and ${handled} is handled correctly`
  );
  value = value.replace(/\bUPC partial search behavior verification\b/i, "UPC partial search behavior is supported");

  // If wording still ends in "verification", rewrite to a concrete verb phrase.
  if (/\bverification$/i.test(value)) {
    value = value.replace(/\bverification$/i, "is validated");
  }

  // Use expected result as a fallback signal if title ended up too terse.
  if (value.length < 20 && testCase.steps[0]?.expected) {
    value = collapseWhitespace(testCase.steps[0].expected)
      .replace(/\.$/, "")
      .replace(/^the\s+/i, "")
      .replace(/^[a-z]/, (char) => char.toLowerCase());
  }

  return collapseWhitespace(value).replace(/\.$/, "");
}

function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}
