import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { WorldbuildingFrameworkData } from "../../../../shared/worldbuilding-types";
import { buildWorldbuildingProductionPackage } from "../../../../shared/worldbuilding-production-package";

export function ProductionPackagePreview({ world }: { world: WorldbuildingFrameworkData }) {
  const [open, setOpen] = useState(false);
  const pkg = useMemo(() => buildWorldbuildingProductionPackage(world), [world]);

  const download = (name: string, text: string, type: string) => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-7 text-xs">產生完整製作包</Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>製作包預覽</DialogTitle>
        </DialogHeader>
        {pkg.warnings.length > 0 && (
          <Badge variant="outline" className="text-amber-700 border-amber-500/40">
            目前製作包可產生，但尚缺的設定可能會影響圖、影、音一致性。
          </Badge>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(pkg.markdown).then(() => toast.success("已複製 Markdown"))}>複製 Markdown</Button>
          <Button size="sm" variant="outline" onClick={() => download("worldbuilding-production-package.md", pkg.markdown, "text/markdown")}>下載 Markdown</Button>
          <Button size="sm" variant="outline" onClick={() => download("worldbuilding-production-package.json", JSON.stringify(pkg.json, null, 2), "application/json")}>下載 JSON</Button>
        </div>
        <ScrollArea className="h-[55vh] rounded border border-border/40 p-3">
          <pre className="text-xs whitespace-pre-wrap">{pkg.markdown}</pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
