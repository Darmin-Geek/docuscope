import { test, expect } from "@playwright/test";
import { sanitizeHtml, isEmptyHtml, htmlOrNull } from "../lib/richText";
import {
  submitDraft,
  getFiles,
  getFileHistory,
  getInformationHistory,
} from "../lib/projects.server";
import type { FileDraftSnapshot } from "../lib/projects";
import { createTestProject, createTestFile } from "./db-helpers";

// Build a submit snapshot with empty defaults, overriding only what a test needs
// (mirrors the helper in field-history.test.ts).
function snapshot(
  overrides: {
    metadata?: Partial<FileDraftSnapshot["metadata"]>;
    information?: FileDraftSnapshot["information"];
  } = {},
): FileDraftSnapshot {
  return {
    metadata: {
      author: null,
      createdDate: null,
      overallBias: null,
      source: null,
      fileReliability: null,
      fileCredibility: null,
      fileReliabilityCode: null,
      fileCredibilityCode: null,
      ...overrides.metadata,
    },
    information: overrides.information ?? [],
  };
}

function infoRow(
  id: string,
  fields: Partial<FileDraftSnapshot["information"][number]> = {},
): FileDraftSnapshot["information"][number] {
  return {
    id,
    informationTitle: "",
    informationText: null,
    overallBias: null,
    informationReliability: null,
    informationCredibility: null,
    informationReliabilityCode: null,
    informationCredibilityCode: null,
    selections: [],
    ...fields,
  };
}

// ── sanitiser unit tests ──────────────────────────────────────────────────────

test.describe("sanitizeHtml", () => {
  test("keeps allow-listed formatting tags", () => {
    const html = "<p><strong>bold</strong> and <em>italic</em> and <u>u</u> <s>s</s></p>";
    expect(sanitizeHtml(html)).toBe(html);
  });

  test("keeps bullet and numbered lists", () => {
    const html = "<ul><li>one</li><li>two</li></ul><ol><li>a</li></ol>";
    expect(sanitizeHtml(html)).toBe(html);
  });

  test("strips <script> tags and their contents", () => {
    const clean = sanitizeHtml("<p>hi</p><script>alert('x')</script>");
    expect(clean).toBe("<p>hi</p>");
    expect(clean).not.toContain("script");
    expect(clean).not.toContain("alert");
  });

  test("drops event-handler and other attributes but keeps the tag", () => {
    const clean = sanitizeHtml('<p onclick="steal()">text</p>');
    expect(clean).toBe("<p>text</p>");
    expect(clean).not.toContain("onclick");
  });

  test("removes an <img> with an onerror handler entirely, keeping inner text", () => {
    const clean = sanitizeHtml('<img src=x onerror="alert(1)">caption');
    expect(clean).not.toContain("img");
    expect(clean).not.toContain("onerror");
    expect(clean).toContain("caption");
  });

  test("allows safe hrefs but rejects javascript: URLs", () => {
    const ok = sanitizeHtml('<a href="https://example.com">link</a>');
    expect(ok).toContain('href="https://example.com"');
    expect(ok).toContain('rel="noopener noreferrer"');

    const bad = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(bad).toBe("<a>x</a>");
    expect(bad).not.toContain("javascript");
  });

  test("rejects javascript: hrefs obfuscated with control chars", () => {
    // A literal tab / newline the URL parser strips would otherwise re-form
    // "java\tscript:" into "javascript:" in the browser.
    for (const c of ["\t", "\n", "\r", "\0"]) {
      const bad = sanitizeHtml(`<a href="java${c}script:alert(1)">x</a>`);
      expect(bad).toBe("<a>x</a>");
      expect(bad.toLowerCase()).not.toContain("script:");
    }
  });

  test("unwraps unknown tags but keeps their text", () => {
    expect(sanitizeHtml("<div><span>hello</span></div>")).toBe("hello");
  });

  test("is idempotent on already-clean HTML", () => {
    const html = "<p><strong>x</strong></p>";
    expect(sanitizeHtml(sanitizeHtml(html))).toBe(html);
  });

  test("treats a legacy plain-text value as valid HTML unchanged", () => {
    expect(sanitizeHtml("just plain text")).toBe("just plain text");
  });
});

test.describe("isEmptyHtml / htmlOrNull", () => {
  test("empty markup counts as empty", () => {
    expect(isEmptyHtml("")).toBe(true);
    expect(isEmptyHtml("<p></p>")).toBe(true);
    expect(isEmptyHtml("<br>")).toBe(true);
    expect(isEmptyHtml("<p>&nbsp;</p>")).toBe(true);
    expect(isEmptyHtml(null)).toBe(true);
  });

  test("visible text is not empty", () => {
    expect(isEmptyHtml("<p>hi</p>")).toBe(false);
  });

  test("htmlOrNull collapses empty editor output to null", () => {
    expect(htmlOrNull("<p></p>")).toBeNull();
    expect(htmlOrNull("<br>")).toBeNull();
    expect(htmlOrNull("")).toBeNull();
    expect(htmlOrNull("<p><strong>keep</strong></p>")).toBe(
      "<p><strong>keep</strong></p>",
    );
  });
});

// ── server round-trip + search ────────────────────────────────────────────────

test.describe("rich text — persistence and search", () => {
  test("formatting round-trips through submit and history", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);

    const html = "<p><strong>bold source</strong></p><ul><li>point</li></ul>";
    await submitDraft(
      projectId,
      fileId,
      "uid-1",
      snapshot({ metadata: { source: html } }),
      "Ada",
    );

    // The stored value keeps its formatting tags…
    const [file] = await getFiles(projectId, null, "");
    expect(file.source).toBe(html);

    // …and the version history records the same HTML for rich rendering.
    const history = await getFileHistory(projectId, fileId);
    expect(history.source[0].value).toBe(html);
  });

  test("search matches visible words, not tags", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);
    await createTestFile(projectId, { filename: "other.pdf" });

    await submitDraft(
      projectId,
      fileId,
      "uid-1",
      snapshot({ metadata: { overallBias: "<strong>biased</strong> reporting" } }),
      "Ada",
    );

    // A visible word matches…
    const hits = await getFiles(projectId, null, "biased");
    expect(hits.map((f) => f.id)).toContain(fileId);

    // …but a stripped tag name does not become a search token.
    const tagHits = await getFiles(projectId, null, "strong");
    expect(tagHits.map((f) => f.id)).not.toContain(fileId);
  });

  test("a crafted script payload is sanitised on submit", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);

    await submitDraft(
      projectId,
      fileId,
      "uid-1",
      snapshot({
        metadata: { source: "<p>ok</p><script>alert(1)</script>" },
      }),
      "Ada",
    );

    const [file] = await getFiles(projectId, null, "");
    expect(file.source).toBe("<p>ok</p>");
    expect(file.source).not.toContain("script");
  });

  test("emptied rich field is stored as null", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId, { source: "<p>old</p>" });

    // Seed a value, then clear it with empty markup.
    await submitDraft(projectId, fileId, "uid-1", snapshot({ metadata: { source: "<p>old</p>" } }), "Ada");
    await submitDraft(projectId, fileId, "uid-1", snapshot({ metadata: { source: "<p></p>" } }), "Ada");

    const [file] = await getFiles(projectId, null, "");
    expect(file.source).toBeNull();

    const history = await getFileHistory(projectId, fileId);
    // Newest version records the cleared (null) value.
    expect(history.source[0].value).toBeNull();
  });

  test("information rich fields round-trip and sanitise", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);
    const infoId = crypto.randomUUID();

    await submitDraft(
      projectId,
      fileId,
      "uid-1",
      snapshot({
        information: [
          infoRow(infoId, {
            informationTitle: "Claim",
            informationText: "<p><em>nuanced</em></p><script>bad()</script>",
          }),
        ],
      }),
      "Ada",
    );

    const history = await getInformationHistory(projectId, fileId, infoId);
    expect(history.informationText[0].value).toBe("<p><em>nuanced</em></p>");
    expect(history.informationText[0].value).not.toContain("script");
  });
});
