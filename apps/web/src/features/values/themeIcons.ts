import {
  Briefcase,
  Bus,
  GraduationCap,
  HeartPulse,
  ShieldAlert,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { ThemeId } from "./contractTypes.js";

/**
 * テーマのアイコン（飾り。意味はテーマ名の文字で伝える）。
 * 色はテーマで変えず、すべて同じ色で描く。キーは正式な契約のテーマID。
 */
export const THEME_ICONS: Readonly<Record<ThemeId, LucideIcon>> = {
  TRANSPORT: Bus,
  EDUCATION_CHILDCARE: GraduationCap,
  ECONOMY_EMPLOYMENT: Briefcase,
  HEALTHCARE_WELFARE: HeartPulse,
  DISASTER_PREVENTION: ShieldAlert,
  POPULATION_REVITALIZATION: Users,
};
