import { buildFrame } from "./frame.js";
import { say, themeName } from "./support.js";
import type { AboutView, ViewBundle } from "./viewTypes.js";

/**
 * The view model of the About screen (Req 5.13): who wrote each question and who
 * approved it, how the map is made, the thresholds, the kind of data, what AI is and is
 * not used for, how much the result rests on, and how much AI took part. The notice
 * that the app is not official (real data only) is added with the real-data task (13.4),
 * so `unofficial` is null for now.
 */

const RULES = ["MAPPING", "WEIGHT", "NON_OPINION", "GROUPING"] as const;
const CONTRIBUTIONS = ["DRAFTED", "REJECTED_BY_CHECKS", "HUMAN_EDITED", "HUMAN_REJECTED"] as const;

export function buildAboutView(bundle: ViewBundle): AboutView {
  const kind = bundle.meta.dataKind;
  const totalQuestions = bundle.questions.length;
  const totalThemes = bundle.themes.length;
  const { t1, t2 } = bundle.mapConfig.thresholds;
  return {
    frame: buildFrame(bundle),
    questions: bundle.questions.map((question) => {
      if (question.approval === null) {
        throw new Error("A published question must carry its approval");
      }
      return {
        questionId: question.questionId,
        themeLabel: question.kind === "PRIORITY_PICK" ? say(bundle, "reflection.crossTheme") : themeName(bundle, question.themeId),
        author: say(bundle, question.author === "HUMAN" ? "about.author.HUMAN" : "about.author.AI_DRAFT"),
        approverId: question.approval.approverId,
      };
    }),
    rules: RULES.map((code) => ({
      code,
      heading: say(bundle, `about.rules.${code}.heading`),
      body: say(bundle, `about.rules.${code}.body`),
    })),
    thresholds: { t1, t2, text: say(bundle, "about.thresholds", { t1, t2 }) },
    dataKind: { kind, label: say(bundle, `label.dataKind.${kind}`), description: say(bundle, `about.dataKind.${kind}`) },
    aiScope: [say(bundle, "about.aiScope")],
    coverage: {
      totalQuestions: say(bundle, "about.coverage.totalQuestions", { totalQuestions }),
      totalThemes: say(bundle, "about.coverage.totalThemes", { totalThemes }),
      limitNote: say(bundle, "about.coverage.limitNote", { totalQuestions, totalThemes }),
    },
    aiContribution: CONTRIBUTIONS.map((code) => ({
      code,
      label: say(bundle, `about.aiContribution.${code}`),
      value: bundle.aiContribution[code],
    })),
    unofficial: null,
  };
}