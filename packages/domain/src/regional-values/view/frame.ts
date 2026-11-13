import { entryOf } from "./support.js";
import type { FrameView, ViewBundle } from "./viewTypes.js";

/** The parts common to every screen: the always-shown banner and the way to the About screen. */
export function buildFrame(bundle: ViewBundle): FrameView {
  const kind = bundle.meta.dataKind;
  return {
    dataKind: kind,
    banner: entryOf(bundle, "BANNER", `banner.${kind}`),
    aboutLink: entryOf(bundle, "ABOUT", "ui.about"),
  };
}