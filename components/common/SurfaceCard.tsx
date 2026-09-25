import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** 白いカード（design-spec.md 2.4：角丸24px、紫がかった柔らかい影、内側の余白16px） */
export function SurfaceCard({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("shadow-card rounded-3xl bg-card p-4 text-card-foreground", className)} {...props} />;
}
