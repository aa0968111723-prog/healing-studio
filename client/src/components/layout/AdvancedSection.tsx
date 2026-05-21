import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
export function AdvancedSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode; }) { return <Collapsible defaultOpen={defaultOpen} className="rounded-xl border border-border/40 bg-card/30 p-3"><CollapsibleTrigger className="text-sm font-medium">{title}</CollapsibleTrigger><CollapsibleContent className="pt-3">{children}</CollapsibleContent></Collapsible>; }
