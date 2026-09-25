import type { InterviewStep } from "@/lib/schemas";

// ---------- 5.7 ヒアリングの台本 ----------
// クイックリプライは ◎ の選択肢を先頭に並べる（10.3章）。自由入力・◎以外の選択でも、
// 次に進む内容は常にこの台本どおりになる（10.3章）。

export type InterviewQuestion = {
  step: InterviewStep;
  stepIndex: number;
  aiMessage: string;
  quickReplies: string[];
};

export const INTERVIEW_QUESTIONS: Record<"category" | "goal" | "current_status" | "conditions" | "time_estimation", InterviewQuestion> = {
  category: {
    step: "category",
    stepIndex: 1,
    aiMessage: "こんにちは！予定づくりをお手伝いします。まずは、今いちばん力を入れたいことを教えてください。",
    quickReplies: ["資格・テスト勉強", "筋トレ・運動", "大学の課題・レポート", "就活", "その他"],
  },
  goal: {
    step: "goal",
    stepIndex: 2,
    aiMessage: "いいですね！具体的にはどんな目標ですか？",
    quickReplies: ["TOEICで730点を取りたい", "まだ決めていない"],
  },
  current_status: {
    step: "current_status",
    stepIndex: 3,
    aiMessage: "今のスコアや、得意・苦手なところはありますか？",
    quickReplies: ["前回は600点。リスニングが苦手", "初めて受ける"],
  },
  conditions: {
    step: "conditions",
    stepIndex: 4,
    aiMessage: "受験日や、勉強しやすい時間帯はありますか？分からなければ「未定」で大丈夫です。",
    quickReplies: ["12月13日に受験予定。平日は夜が中心", "未定"],
  },
  time_estimation: {
    step: "time_estimation",
    stepIndex: 5,
    aiMessage:
      "ありがとうございます。試験まで約10週間です。登録済みの授業・バイトの予定もふまえて、目標時間の案を3つ作りました。どれも正解・不正解はないので、しっくりくるものを選んでください。",
    quickReplies: [],
  },
};

/** ステップ9：最終確認（要件定義書6.2.4参照） */
export const FINAL_CONFIRMATION_MESSAGE = "この内容で確定してよいですか？あとから変更もできます。";

/**
 * ステップ8：要約（要件定義書6.2.4の定型文。5.7章の追記のとおり、
 * タスク名1＝TOEIC学習、末尾に登録済みタスクの締切を考慮する旨を追加する）
 */
export function buildSummaryMessage(hoursPerWeek: number): string {
  return `目標の整理が完了しました！👍

📚 今週の目標データ
・TOEIC学習：週${hoursPerWeek}時間（12月13日受験・現在600点→目標730点）

⏱️ 今週の合計目標時間：${hoursPerWeek}時間

この条件を元に、あなたの生活リズムや固定予定に合わせた
おすすめのスケジュールプランを3つ作成します！

準備ができたら「スケジュール作成」を押してください。

登録済みのゼミレポート（10/9締切）とES（10/12締切）も一緒に考慮します。`;
}
