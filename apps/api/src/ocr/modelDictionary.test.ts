import { describe, expect, it } from "vitest";

import { characterDictionaryFromYaml } from "./modelDictionary.js";

describe("characterDictionaryFromYaml", () => {
  it("reads plain, single-quoted and double-quoted entries", () => {
    const yaml = [
      "PostProcess:",
      "  name: CTCLabelDecode",
      "  character_dict:",
      "  - 日",
      "  - a",
      "  - '#'",
      "  - ''''",
      "  - ' '",
      '  - "\\\\"',
      '  - "\\u3042"',
      '  - "\\x41"',
      "  - '0'",
      "Other: value",
      "  - not part of the list",
    ].join("\n");

    expect(characterDictionaryFromYaml(yaml)).toEqual(["日", "a", "#", "'", " ", "\\", "あ", "A", "0"]);
  });

  it("accepts CRLF line endings", () => {
    expect(characterDictionaryFromYaml("character_dict:\r\n  - 一\r\n  - 二\r\n")).toEqual(["一", "二"]);
  });

  it("returns undefined without the key, without entries or with an undecodable entry", () => {
    expect(characterDictionaryFromYaml("Global:\n  model_name: x\n")).toBeUndefined();
    expect(characterDictionaryFromYaml("character_dict:\nnext: 1\n")).toBeUndefined();
    expect(characterDictionaryFromYaml('character_dict:\n  - "\\q"\n')).toBeUndefined();
  });
});