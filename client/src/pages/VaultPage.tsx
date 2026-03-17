import { ConsistencyVault } from "@/components/ConsistencyVault";
import { Layers } from "lucide-react";

export default function VaultPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
          <Layers className="w-6 h-6" />
          一致性保險庫
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          管理角色與場景參考圖，確保跨作品的風格一致性。可拖放至創作工作室使用。
        </p>
      </div>

      {/* Full Vault Component */}
      <div className="max-w-2xl">
        <ConsistencyVault />
      </div>
    </div>
  );
}
