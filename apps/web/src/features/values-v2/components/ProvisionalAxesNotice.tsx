import { Badge } from "../../../shared/ui/Badge.js";
import { NoticeBar } from "../../../shared/ui/NoticeBar.js";

/** 中立性の点検が終わっていないことを示す札の文言 */
export const NEUTRALITY_PENDING_LABEL = "中立性の点検前";

type ProvisionalAxesNoticeProps = Readonly<{
  className?: string;
}>;

/**
 * 質問の文面、6つの考え方（価値観の軸）の名前と説明、考え方A・Bへの割り当てが暫定で、
 * 中立性の点検が終わっていないことの表示（v2。開始画面と結果画面に出す）。
 * 点検と承認が済むまで出す（records/values-v2-axis-analysis.md の10）。外すときは、この部品の利用箇所ごと外す。
 */
export function ProvisionalAxesNotice({ className = "" }: ProvisionalAxesNoticeProps) {
  return (
    <div className={className} data-provisional-axes="true">
      <NoticeBar>
        <Badge>{NEUTRALITY_PENDING_LABEL}</Badge>{" "}
        質問の文面、6つの考え方（価値観レーダーの軸）の名前と説明、各質問の考え方A・Bへの割り当ては、暫定です。特定の考え方や立場に有利・不利な書き方になっていないかの点検（中立性の点検）は、まだ終わっていません。
      </NoticeBar>
    </div>
  );
}
