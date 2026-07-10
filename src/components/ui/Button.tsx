import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import clsx from "clsx";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-solid";
export type ButtonSize    = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:  ButtonVariant;
  size?:     ButtonSize;
  loading?:  boolean;
  leftIcon?: React.ReactNode;
  fullWidth?: boolean;
}

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  // soft-ui-sm (theme-aware embossed shadow, see globals.css) instead of a
  // flat shadow-sm — was previously only applied ad hoc to one button
  // (PublishPanel's "Опубликовать"); now every primary CTA gets it.
  primary:      "bg-[var(--accent)] hover:bg-[var(--accent-hover)] active:scale-[0.97] text-white soft-ui-sm",
  secondary:    "bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] active:scale-[0.97] text-[var(--text-primary)] border border-[var(--border-default)]",
  ghost:        "bg-transparent hover:bg-[var(--bg-hover)] active:scale-[0.97] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
  danger:       "bg-transparent hover:bg-[var(--danger-subtle)] active:scale-[0.97] text-[var(--danger)] border border-[var(--danger)]",
  "danger-solid": "bg-[var(--danger)] hover:opacity-90 active:scale-[0.97] text-white shadow-sm",
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  sm: "h-7  px-3  text-xs  gap-1.5",
  md: "h-8  px-4  text-sm  gap-2",
  lg: "h-10 px-5  text-sm  gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant  = "secondary",
      size     = "md",
      loading  = false,
      leftIcon,
      fullWidth,
      children,
      disabled,
      className,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={clsx(
          "inline-flex items-center justify-center font-medium rounded-md transition-all select-none",
          "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
          VARIANT_STYLES[variant],
          SIZE_STYLES[size],
          fullWidth && "w-full",
          className
        )}
        {...props}
      >
        {loading ? (
          <Spinner size={14} />
        ) : (
          leftIcon && <span className="flex-shrink-0">{leftIcon}</span>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
