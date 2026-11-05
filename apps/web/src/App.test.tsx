// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithRouter } from "../../../tests/harness/react-renderer.js";
import { App } from "./App.js";

describe("App", () => {
  it("renders the P0 home inside the local-only shell", () => {
    renderWithRouter(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "えひめ投票ナビ" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("会場ローカルデモ・一般公開ではありません"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "2022年に終了した過去選挙です。現在または将来の投票所判断には使えません",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("NOT_READY").length).toBeGreaterThan(0);
  });
});
