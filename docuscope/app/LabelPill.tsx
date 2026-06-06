"use client";

import type { CSSProperties, MouseEvent, ReactNode } from "react";

/**
 * Pick black or white text for a given hex background so the label stays
 * readable regardless of its color. Accepts 3- or 6-digit hex.
 */
export function contrastColor(hex: string): string {
  const cleaned = hex.replace("#", "");
  const full =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  // Perceived luminance (ITU-R BT.601).
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#000000" : "#ffffff";
}

type LabelPillProps = {
  label: string;
  color: string;
  /**
   * When true the pill is filled with its color; when false it renders as an
   * outline in that color (used for the unselected state of a filter pill).
   */
  filled?: boolean;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  title?: string;
  className?: string;
  /** Trailing content, e.g. a remove (×) button. */
  children?: ReactNode;
};

/** A small rounded pill that displays a label tinted by its color. */
export default function LabelPill({
  label,
  color,
  filled = true,
  onClick,
  title,
  className = "",
  children,
}: LabelPillProps) {
  const style: CSSProperties = filled
    ? { backgroundColor: color, color: contrastColor(color) }
    : { borderColor: color, color };

  const Tag = onClick ? "button" : "span";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title ?? label}
      style={style}
      className={`inline-flex max-w-full items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-xs font-medium leading-tight ${
        onClick ? "cursor-pointer transition-opacity hover:opacity-80" : ""
      } ${className}`}
    >
      <span className="truncate">{label || "Untitled"}</span>
      {children}
    </Tag>
  );
}
