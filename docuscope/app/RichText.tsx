"use client";

import { sanitizeHtml } from "@/lib/richText";

// Read-only renderer for a stored rich-text field value (issue #81). Every place
// that *displays* one of the paragraph fields — and the version-history popover —
// renders through here so untrusted stored markup is always sanitised before it
// reaches the DOM. `dangerouslySetInnerHTML` is only safe because the HTML is run
// through the shared allow-list sanitiser first (defence-in-depth on top of the
// editor's constrained output and the server-side sanitisation on write).
export default function RichText({
  html,
  className,
}: {
  html: string | null | undefined;
  className?: string;
}) {
  if (!html) return null;
  const clean = sanitizeHtml(html);
  if (!clean) return null;
  return (
    <div
      className={`rich-text${className ? ` ${className}` : ""}`}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
