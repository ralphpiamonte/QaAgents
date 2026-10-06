export function adfToPlainText(input: unknown): string {
  if (!input) return "";

  if (typeof input === "string") {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => adfToPlainText(item)).filter(Boolean).join(" ");
  }

  if (typeof input !== "object") {
    return "";
  }

  const node = input as {
    text?: string;
    content?: unknown[];
    attrs?: Record<string, unknown>;
    type?: string;
  };

  const parts: string[] = [];

  if (typeof node.text === "string") {
    parts.push(node.text);
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const text = adfToPlainText(child);
      if (text) parts.push(text);
    }
  }

  if (node.type === "hardBreak") {
    parts.push("\n");
  }

  if (node.type === "mention" && typeof node.attrs?.text === "string") {
    parts.push(node.attrs.text);
  }

  return parts.join(" ").replace(/\s+\n/g, "\n").replace(/\n\s+/g, "\n").trim();
}

