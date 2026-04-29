import { useState } from "react";

export default function AgentEvalPage() {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<any>(null);

  const runEval = async () => {
    setLoading(true);
    try {
      // replace with trpc mutation wiring in app routes
      const res = await fetch("/api/trpc/adminEval.runAgentEval", { method: "POST" });
      const data = await res.json();
      setReport(data?.result?.data ?? null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <button onClick={runEval} className="px-3 py-2 rounded bg-black text-white">執行評估</button>
      {loading && <div>Running...</div>}
      {report && (
        <div>
          <div>{report.passed}/{report.totalCases} 通過，平均分數 {Number(report.averageScore).toFixed(2)}</div>
          <table className="w-full text-sm mt-2">
            <thead><tr><th>Case ID</th><th>描述</th><th>通過</th><th>分數</th><th>違規項目</th></tr></thead>
            <tbody>{report.results?.map((r: any) => <tr key={r.caseId} className={r.passed ? "bg-green-50" : "bg-red-50"}><td>{r.caseId}</td><td>{r.caseId}</td><td>{String(r.passed)}</td><td>{r.score}</td><td>{(r.violations ?? []).join(", ")}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
