function decodeDoubleQuoted(raw: string): string | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === "string") {
      return value;
    }
  } catch {
    // Fall through to the \x escape form below.
  }
  const hex = raw.slice(1, -1).replace(/\\x([0-9a-fA-F]{2})/gu, (_, digits: string) =>
    String.fromCharCode(Number.parseInt(digits, 16)),
  );
  return hex.includes("\\") ? undefined : hex;
}

function decodeScalar(raw: string): string | undefined {
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replaceAll("''", "'");
  }
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return decodeDoubleQuoted(raw);
  }
  return raw;
}

/**
 * Reads the `character_dict` list of a PaddleOCR `inference.yml`: one entry per
 * `- ` line below the key. It understands the plain, single-quoted and
 * double-quoted forms that PaddleOCR writes, and nothing else. Returns
 * undefined when the key is missing or an entry cannot be decoded.
 */
export function characterDictionaryFromYaml(yaml: string): string[] | undefined {
  const lines = yaml.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^\s*character_dict:\s*$/u.test(line));
  if (start < 0) {
    return undefined;
  }

  const entries: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const item = /^\s*- (.*)$/u.exec(line);
    if (item === null) {
      break;
    }
    const entry = decodeScalar(item[1] ?? "");
    if (entry === undefined) {
      return undefined;
    }
    entries.push(entry);
  }
  return entries.length === 0 ? undefined : entries;
}