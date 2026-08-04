import { test, expect, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../lib/drizzle/db";
import {
  labels as labelsTable,
  informationLabels,
  informationDatetimes,
  timelineEntries,
} from "../lib/drizzle/schema";
import { submitDraft } from "../lib/projects.server";
import type { FileDraftSnapshot } from "../lib/projects";
import { injectOidcUser } from "./helpers";
import {
  createTestProject,
  addTestContributor,
  createTestFile,
  createTestTimeline,
  addTestTimelineEntry,
} from "./db-helpers";

// Option 2 — labels and dates ride in the draft snapshot and are reconciled into
// the information_labels / information_datetimes tables inside submitDraft's
// transaction. These tests exercise the server reconciliation directly (no
// browser) plus the UI flow of attaching a label + date to a brand-new,
// never-submitted row.

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyMeta(): FileDraftSnapshot["metadata"] {
  return {
    author: null,
    createdDate: null,
    overallBias: null,
    source: null,
    fileReliability: null,
    fileCredibility: null,
    fileReliabilityCode: null,
    fileCredibilityCode: null,
  };
}

type DraftInfo = FileDraftSnapshot["information"][number];
type DraftDatetime = DraftInfo["datetimes"][number];

function infoRow(id: string, fields: Partial<DraftInfo> = {}): DraftInfo {
  return {
    id,
    informationTitle: "",
    informationText: null,
    overallBias: null,
    informationReliability: null,
    informationCredibility: null,
    informationReliabilityCode: null,
    informationCredibilityCode: null,
    labels: [],
    datetimes: [],
    selections: [],
    ...fields,
  };
}

function pointDatetime(
  id: string,
  startValue: string,
): DraftDatetime {
  return {
    id,
    isRange: false,
    startValue,
    startPrecision: "year",
    endValue: null,
    endPrecision: null,
  };
}

async function createInfoLabel(projectId: string, label: string): Promise<string> {
  const [row] = await db
    .insert(labelsTable)
    .values({ projectId, label, color: "#22c55e", kind: "information" })
    .returning({ id: labelsTable.id });
  return row.id;
}

// ── server reconciliation ────────────────────────────────────────────────────

test.describe("submitDraft — labels & datetimes reconciliation (Option 2)", () => {
  test("persists labels and datetimes staged on a brand-new row", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);
    const labelId = await createInfoLabel(projectId, "Fact");

    const infoId = crypto.randomUUID();
    const dtId = crypto.randomUUID();
    const snapshot: FileDraftSnapshot = {
      metadata: emptyMeta(),
      information: [
        infoRow(infoId, {
          informationTitle: "Claim",
          labels: [labelId],
          datetimes: [pointDatetime(dtId, "1994-01-01T00:00")],
        }),
      ],
    };

    await submitDraft(projectId, fileId, "uid-1", snapshot, "Editor One");

    const lbls = await db
      .select()
      .from(informationLabels)
      .where(eq(informationLabels.informationId, infoId));
    expect(lbls.map((l) => l.labelId)).toEqual([labelId]);

    const dts = await db
      .select()
      .from(informationDatetimes)
      .where(eq(informationDatetimes.informationId, infoId));
    expect(dts).toHaveLength(1);
    expect(dts[0].id).toBe(dtId);
    // Bounds are re-derived server-side (the snapshot never carries them).
    expect(Number(dts[0].lowerMs)).toBe(Date.UTC(1994, 0, 1));
    expect(Number(dts[0].upperMs)).toBe(Date.UTC(1995, 0, 1));
  });

  test("reconciles on re-submit and an unchanged datetime keeps its id (timeline pin survives)", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);
    const labelA = await createInfoLabel(projectId, "A");
    const labelB = await createInfoLabel(projectId, "B");

    const infoId = crypto.randomUUID();
    const keepDtId = crypto.randomUUID();
    const editDtId = crypto.randomUUID();
    const dropDtId = crypto.randomUUID();

    const first: FileDraftSnapshot = {
      metadata: emptyMeta(),
      information: [
        infoRow(infoId, {
          informationTitle: "Claim",
          labels: [labelA, labelB],
          datetimes: [
            pointDatetime(keepDtId, "1994-01-01T00:00"),
            pointDatetime(editDtId, "2000-01-01T00:00"),
            pointDatetime(dropDtId, "2010-01-01T00:00"),
          ],
        }),
      ],
    };
    await submitDraft(projectId, fileId, "uid-1", first, "Editor One");

    // Pin the datetime we intend to leave unchanged to a timeline.
    const timelineId = await createTestTimeline(projectId);
    await addTestTimelineEntry(timelineId, keepDtId);

    // Re-submit: drop labelB, keep keepDt untouched, edit editDt's value, and
    // drop dropDt entirely.
    const second: FileDraftSnapshot = {
      metadata: emptyMeta(),
      information: [
        infoRow(infoId, {
          informationTitle: "Claim",
          labels: [labelA],
          datetimes: [
            pointDatetime(keepDtId, "1994-01-01T00:00"),
            pointDatetime(editDtId, "2001-01-01T00:00"),
          ],
        }),
      ],
    };
    await submitDraft(projectId, fileId, "uid-1", second, "Editor One");

    // Labels reconciled down to just labelA.
    const lbls = await db
      .select()
      .from(informationLabels)
      .where(eq(informationLabels.informationId, infoId));
    expect(lbls.map((l) => l.labelId)).toEqual([labelA]);

    // Datetimes: keep + edit survive, drop is gone.
    const dts = await db
      .select()
      .from(informationDatetimes)
      .where(eq(informationDatetimes.informationId, infoId));
    const byId = new Map(dts.map((d) => [d.id, d]));
    expect(dts).toHaveLength(2);
    expect(byId.has(keepDtId)).toBe(true);
    expect(byId.has(editDtId)).toBe(true);
    expect(byId.has(dropDtId)).toBe(false);
    // The edited datetime re-derived its new bounds.
    expect(Number(byId.get(editDtId)!.lowerMs)).toBe(Date.UTC(2001, 0, 1));

    // The unchanged datetime kept its id, so its timeline pin still resolves.
    const pins = await db
      .select()
      .from(timelineEntries)
      .where(eq(timelineEntries.datetimeId, keepDtId));
    expect(pins).toHaveLength(1);
    expect(pins[0].timelineId).toBe(timelineId);
  });
});

// ── UI: attach a label + date before any submit ──────────────────────────────

test.describe("Information sidebar — labels/dates on unsubmitted rows (Option 2)", () => {
  test("a label and a date added before any submit persist through Submit + reload", async ({
    page,
  }) => {
    const uid = unique("uid");
    const email = `${uid}@test.com`;
    const title = unique("Option2 Project");
    const projectId = await createTestProject(title);
    await addTestContributor(projectId, email);
    // Raw-seeded projects have no labels; add an 'information' label to assign.
    await createInfoLabel(projectId, "Fact");
    await createTestFile(projectId, { filename: "ui.pdf" });

    await injectOidcUser(page, uid, email);
    await expect(page.getByRole("heading", { name: "Your Projects" })).toBeVisible();

    await page.getByRole("button", { name: title }).click();
    await expect(page.getByRole("button", { name: "Create Folder" })).toBeVisible();
    await page.getByRole("cell", { name: "ui.pdf" }).click();

    const fileSidebar = page.locator("aside").last();
    await expect(fileSidebar.getByRole("heading", { name: "ui.pdf" })).toBeVisible();
    await fileSidebar.getByRole("button", { name: "Check Out" }).click();
    await expect(fileSidebar.getByRole("button", { name: "Check In" })).toBeVisible();
    await fileSidebar.getByRole("button", { name: "Open information view" }).click();

    const infoSidebar = page.locator("aside").filter({
      has: page.getByRole("heading", { name: "Information" }),
    });

    // New, never-submitted entry.
    await infoSidebar.getByRole("button", { name: "+ Add New Information" }).click();
    await infoSidebar.locator("input[placeholder='Untitled']").fill("Dated Claim");

    // Attach a label BEFORE any Save/Submit.
    await infoSidebar.getByRole("button", { name: "+ Label" }).click();
    await infoSidebar.getByRole("button", { name: "Fact", exact: true }).click();
    await expect(
      infoSidebar.getByRole("button", { name: "Remove Fact" }),
    ).toBeVisible();

    // Attach a date BEFORE any Save/Submit (defaults to a year-precision point).
    await infoSidebar.getByRole("button", { name: "+ Add date" }).click();
    await infoSidebar.getByRole("button", { name: "Save date" }).click();
    await expect(
      infoSidebar.getByRole("button", { name: /^Edit date/ }),
    ).toBeVisible();

    // Submit publishes labels + dates alongside the row.
    await fileSidebar.getByRole("button", { name: "Submit" }).click();
    await expect(fileSidebar.getByText("Submitted.")).toBeVisible();

    // Reload: the draft is gone; labels + dates come back from the main tables.
    await page.reload();
    await page.getByRole("cell", { name: "ui.pdf" }).click();
    const fileSidebar2 = page.locator("aside").last();
    await expect(fileSidebar2.getByRole("heading", { name: "ui.pdf" })).toBeVisible();
    await fileSidebar2.getByRole("button", { name: "Open information view" }).click();

    const infoSidebar2 = page.locator("aside").filter({
      has: page.getByRole("heading", { name: "Information" }),
    });
    await infoSidebar2.getByRole("button", { name: "Dated Claim", exact: true }).click();
    await expect(
      infoSidebar2.getByRole("button", { name: "Remove Fact" }),
    ).toBeVisible();
    await expect(
      infoSidebar2.getByRole("button", { name: /^Edit date/ }),
    ).toBeVisible();
  });
});
