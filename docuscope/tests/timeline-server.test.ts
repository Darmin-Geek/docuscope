import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../lib/drizzle/db";
import { information, informationDatetimes, timelineEntries } from "../lib/drizzle/schema";
import {
  getDatetimes,
  validateAndDerive,
  getTimelines,
  createTimeline,
  updateTimeline,
  getTimelineEntries,
  addTimelineEntry,
  removeTimelineEntry,
} from "../lib/timelines.server";
import {
  createTestProject,
  createTestFile,
  createTestInformation,
  createTestDatetime,
} from "./db-helpers";

// Server-side tests for the timeline feature. These call the lib/timelines.server
// functions directly against the test database (no browser), mirroring the
// getFiles server tests in search.test.ts.

// Datetime writes now go through the file draft snapshot and are reconciled in
// submitDraft (see draft-labels-dates.test.ts). validateAndDerive is the single
// bound-derivation path both use, so its output is tested directly here; the
// read + project-scoping path (getDatetimes) is exercised against seeded rows.
test.describe("datetime bound derivation + reads", () => {
  test("derives point bounds from value + precision", () => {
    const bounds = validateAndDerive({
      isRange: false,
      startValue: "1994-01-01T00:00",
      startPrecision: "year",
      endValue: null,
      endPrecision: null,
    });

    // Year 1994 → [1994-01-01, 1995-01-01), no core bounds. validateAndDerive
    // returns bigint ms (the DB column type); Number() mirrors how toDatetime
    // exposes them to the client.
    expect(Number(bounds.lowerMs)).toBe(Date.UTC(1994, 0, 1));
    expect(Number(bounds.upperMs)).toBe(Date.UTC(1995, 0, 1));
    expect(bounds.coreLowerMs).toBeNull();
    expect(bounds.coreUpperMs).toBeNull();
  });

  test("derives range core + whisker bounds (decade start, month end)", () => {
    const bounds = validateAndDerive({
      isRange: true,
      startValue: "1980-01-01T00:00",
      startPrecision: "decade",
      endValue: "1995-03-01T00:00",
      endPrecision: "month",
    });

    expect(Number(bounds.lowerMs)).toBe(Date.UTC(1980, 0, 1)); // decade start = left whisker edge
    expect(Number(bounds.coreLowerMs)).toBe((Date.UTC(1980, 0, 1) + Date.UTC(1990, 0, 1)) / 2); // mid-decade = solid start
    expect(Number(bounds.coreUpperMs)).toBe((Date.UTC(1995, 2, 1) + Date.UTC(1995, 3, 1)) / 2); // mid-March = solid end
    expect(Number(bounds.upperMs)).toBe(Date.UTC(1995, 3, 1)); // Apr 1995 = right whisker end
  });

  test("rejects a reversed range", () => {
    expect(() =>
      validateAndDerive({
        isRange: true,
        startValue: "2000-01-01T00:00",
        startPrecision: "year",
        endValue: "1990-01-01T00:00",
        endPrecision: "year",
      }),
    ).toThrow("Invalid");
  });

  test("lists a row's datetimes ordered by lower bound", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);
    const infoId = await createTestInformation(fileId);
    await createTestDatetime(infoId, {
      startValue: "1900-01-01T00:00",
      startPrecision: "year",
    });

    const rows = await getDatetimes(projectId, fileId, infoId);
    expect(rows).toHaveLength(1);
    expect(rows[0].lowerMs).toBe(Date.UTC(1900, 0, 1));
  });

  test("cannot read datetimes through a mismatched project", async () => {
    const projectA = await createTestProject();
    const projectB = await createTestProject();
    const fileId = await createTestFile(projectA);
    const infoId = await createTestInformation(fileId);
    await createTestDatetime(infoId);

    await expect(getDatetimes(projectB, fileId, infoId)).rejects.toThrow(
      "Not found",
    );
  });
});

test.describe("timeline CRUD + entries", () => {
  test("creates and lists timelines in a project", async () => {
    const projectId = await createTestProject();
    const tl = await createTimeline(projectId, {
      title: "My timeline",
      description: null,
    });
    expect(tl.title).toBe("My timeline");

    const rows = await getTimelines(projectId);
    expect(rows.map((t) => t.id)).toContain(tl.id);
  });

  test("persists and reads back the default view", async () => {
    const projectId = await createTestProject();
    const tl = await createTimeline(projectId, { title: "T", description: null });

    await updateTimeline(projectId, tl.id, {
      defaultStartMs: Date.UTC(1990, 0, 1),
      defaultSpanMs: 10 * 365 * 24 * 3600 * 1000,
    });

    const [row] = await getTimelines(projectId);
    expect(row.defaultStartMs).toBe(Date.UTC(1990, 0, 1));
    expect(row.defaultSpanMs).toBe(10 * 365 * 24 * 3600 * 1000);
  });

  test("attaches a datetime and returns it joined to its information", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);
    const infoId = await createTestInformation(fileId, {
      informationTitle: "Moon Landing",
    });
    const dtId = await createTestDatetime(infoId, {
      startValue: "1969-01-01T00:00",
      startPrecision: "year",
    });
    const tl = await createTimeline(projectId, { title: "History", description: null });

    await addTimelineEntry(projectId, tl.id, dtId);

    const entries = await getTimelineEntries(projectId, tl.id);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Moon Landing");
    expect(entries[0].fileId).toBe(fileId);
    expect(entries[0].informationId).toBe(infoId);
    expect(entries[0].lowerMs).toBe(Date.UTC(1969, 0, 1));

    await removeTimelineEntry(projectId, tl.id, dtId);
    expect(await getTimelineEntries(projectId, tl.id)).toHaveLength(0);
  });

  test("cannot attach a datetime from another project", async () => {
    const projectA = await createTestProject();
    const projectB = await createTestProject();
    const fileId = await createTestFile(projectA);
    const infoId = await createTestInformation(fileId);
    const dtId = await createTestDatetime(infoId);
    const tlB = await createTimeline(projectB, { title: "B", description: null });

    await expect(addTimelineEntry(projectB, tlB.id, dtId)).rejects.toThrow(
      "Not found",
    );
  });

  test("deleting the information cascades to datetimes and timeline entries", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);
    const infoId = await createTestInformation(fileId);
    const dtId = await createTestDatetime(infoId);
    const tl = await createTimeline(projectId, { title: "T", description: null });
    await addTimelineEntry(projectId, tl.id, dtId);

    await db.delete(information).where(eq(information.id, infoId));

    const dts = await db
      .select()
      .from(informationDatetimes)
      .where(eq(informationDatetimes.id, dtId));
    expect(dts).toHaveLength(0);

    const ents = await db
      .select()
      .from(timelineEntries)
      .where(eq(timelineEntries.datetimeId, dtId));
    expect(ents).toHaveLength(0);
  });
});
