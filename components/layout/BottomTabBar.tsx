"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TAB_ITEMS } from "@/lib/labels";

/**
 * 通常利用の画面の下部タブバー（design-spec.md 5.2）。
 * 白背景・上に細い境界線。選択中は --brand-purple、それ以外は --purple-gray。
 * MobileShell の bottom に渡して使う（列の下端に固定される）。
 */
export function BottomTabBar() {
  const pathname = usePathname();

  return (
    <nav aria-label="メインメニュー" className="border-t bg-card pb-[env(safe-area-inset-bottom)]">
      <ul className="grid h-16 grid-cols-4">
        {TAB_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className="flex h-full min-h-11 flex-col items-center justify-center gap-1 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ color: active ? "var(--brand-purple)" : "var(--purple-gray)" }}
              >
                <Icon size={22} strokeWidth={active ? 2.4 : 2} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
