import { NavLink } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import clsx from "clsx";

interface SidebarItemProps {
  to: string;
  icon: LucideIcon;
  label: string;
  badge?: number;
  dataTour?: string;
}

export function SidebarItem({ to, icon: Icon, label, badge, dataTour }: SidebarItemProps) {
  return (
    <NavLink
      to={to}
      data-tour={dataTour}
      className={({ isActive }) =>
        clsx(
          "relative flex items-center gap-2.5 px-3 h-9 rounded-md mx-2 transition-colors text-sm font-medium select-none",
          isActive
            ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* Active indicator */}
          {isActive && (
            <span
              className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
              style={{ backgroundColor: "var(--accent)" }}
            />
          )}

          <Icon
            size={16}
            strokeWidth={1.75}
            style={{ color: isActive ? "var(--accent)" : "inherit" }}
          />

          <span className="flex-1 truncate">{label}</span>

          {badge !== undefined && badge > 0 && (
            <Badge count={badge} />
          )}
        </>
      )}
    </NavLink>
  );
}
