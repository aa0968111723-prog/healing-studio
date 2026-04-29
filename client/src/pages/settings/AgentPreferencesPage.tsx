import { useState } from "react";

export default function AgentPreferencesPage() {
  const [confirmationPolicy, setConfirmationPolicy] = useState("confirm_high_risk");
  const [maxAutoStepsPerTask, setMaxAutoStepsPerTask] = useState(5);
  const [notifyOnCompletion, setNotifyOnCompletion] = useState(true);
  const [notifyOnError, setNotifyOnError] = useState(true);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">AI 代理確認設定</h1>
      <div>
        <label><input type="radio" checked={confirmationPolicy === "always_approve"} onChange={() => setConfirmationPolicy("always_approve")} /> 一律自動同意</label>
        <label><input type="radio" checked={confirmationPolicy === "confirm_high_risk"} onChange={() => setConfirmationPolicy("confirm_high_risk")} /> 只有高風險才詢問</label>
        <label><input type="radio" checked={confirmationPolicy === "confirm_all"} onChange={() => setConfirmationPolicy("confirm_all")} /> 每步都詢問</label>
      </div>
      <div>
        <label>單次任務最多自動執行步驟數</label>
        <input type="number" min={1} max={20} value={maxAutoStepsPerTask} onChange={e => setMaxAutoStepsPerTask(Number(e.target.value))} />
      </div>
      <label><input type="checkbox" checked={notifyOnCompletion} onChange={e => setNotifyOnCompletion(e.target.checked)} /> 任務完成時通知我</label>
      <label><input type="checkbox" checked={notifyOnError} onChange={e => setNotifyOnError(e.target.checked)} /> 任務失敗時通知我</label>
      <button className="px-3 py-2 rounded bg-black text-white">儲存設定</button>
    </div>
  );
}
