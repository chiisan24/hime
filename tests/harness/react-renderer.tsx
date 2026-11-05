import {
  cleanup,
  render,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

export type RouterRenderOptions = Omit<RenderOptions, "wrapper"> &
  Readonly<{
    initialEntries?: string[];
  }>;

/** Renders web UI with an isolated in-memory route history. */
export function renderWithRouter(
  ui: ReactElement,
  options: RouterRenderOptions = {},
): RenderResult {
  const { initialEntries = ["/"], ...renderOptions } = options;

  return render(
    <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>,
    renderOptions,
  );
}
