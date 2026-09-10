import { NavLink } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Tooltip } from "@/components/ui/Tooltip";
import clsx from "clsx";

interface SidebarItemAction {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

interface SidebarItemProps {
  to: string;
  icon: LucideIcon;
  label: string;
  badge?: number;
  dataTour?: string;
  /** Match the route exactly — needed for the "/" dashboard link, which
   * would otherwise be "active" on every page. */
  end?: boolean;
  /** Secondary action button rendered beside the row (not inside the
   * NavLink — nesting a second interactive element inside an <a> is invalid
   * HTML and would fire both click handlers at once). Currently only the
   * "Редактор" row uses this, for the "Создать новый пост" shortcut. */
  action?: SidebarItemAction;
}

export function SidebarItem({ to, icon: Icon, label, badge, dataTour, end, action }: SidebarItemProps) {
  const link = (
    <NavLink
      to={to}
      end={end}
      data-tour={dataTour}
      className={({ isActive }) =>
        clsx(
          "relative flex items-center gap-2.5 px-3 h-9 rounded-md transition-colors text-sm font-medium select-none",
          isActive
            ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
          action ? "flex-1 min-w-0" : "mx-2"
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
            style={{ color: isActive ? "var(--accent)" : "inherit", flexShrink: 0 }}
          />

          <span className="flex-1 truncate">{label}</span>

          {badge !== undefined && badge > 0 && (
            <Badge count={badge} />
          )}
        </>
      )}
    </NavLink>
  );

  if (!action) return link;

  const ActionIcon = action.icon;
  return (
    <div className="flex items-center gap-1 mx-2">
      {link}
      <Tooltip content={action.label}>
        <button
          type="button"
          aria-label={action.label}
          onClick={action.onClick}
          className="flex items-center justify-center flex-shrink-0 w-9 h-9 rounded-md transition-colors text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <ActionIcon size={16} strokeWidth={1.75} />
        </button>
      </Tooltip>
    </div>
  );
}
