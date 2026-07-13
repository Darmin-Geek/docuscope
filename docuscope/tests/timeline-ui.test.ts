import { test, expect } from "@playwright/test";
import { injectOidcUser } from "./helpers";
import {
  createTestProject,
  addTestContributor,
  createTestFile,
  createTestInformation,
  createTestDatetime,
} from "./db-helpers";

// End-to-end UI coverage for the timeline feature: open the timeline view,
// create a timeline, pin a dated piece of information, see its bar, and click
// through to the information view.

test("timeline view: create, add dated info, see bar, click through", async ({
  page,
}) => {
  const stamp = Date.now();
  const email = `tl-${stamp}@example.com`;
  const uid = `uid-${stamp}`;
  const projectName = `Timeline Project ${stamp}`;

  // Seed a project the user contributes to, with one dated piece of information.
  const projectId = await createTestProject(projectName);
  await addTestContributor(projectId, email);
  const fileId = await createTestFile(projectId, { filename: "apollo.pdf" });
  const infoId = await createTestInformation(fileId, {
    informationTitle: "Moon Landing",
  });
  await createTestDatetime(infoId, {
    startValue: "1969-01-01T00:00",
    startPrecision: "year",
  });

  await injectOidcUser(page, uid, email);
  await expect(
    page.getByRole("heading", { name: "Your Projects" }),
  ).toBeVisible();

  // Open the project, then the timeline workspace.
  await page.getByRole("button", { name: projectName }).click();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Timelines" }),
  ).toBeVisible();

  // Create a timeline.
  const timelineTitle = `Space Race ${stamp}`;
  await page.getByLabel("New timeline title").fill(timelineTitle);
  await page.getByRole("button", { name: "+ New timeline" }).click();
  await expect(
    page.getByRole("heading", { name: timelineTitle }),
  ).toBeVisible();

  // Pin the dated information through the picker.
  await page.getByRole("button", { name: "+ Add information" }).click();
  const picker = page.getByRole("dialog", {
    name: "Add information to timeline",
  });
  await picker.getByLabel("Search files").fill("apollo");
  await picker.getByRole("button", { name: "apollo.pdf" }).click();
  await picker.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove" })).toBeVisible();
  await page.getByRole("button", { name: "Close picker" }).click();

  // The bar labelled with the information title appears on the canvas.
  const bar = page.locator("svg text", { hasText: "Moon Landing" });
  await expect(bar).toBeVisible();

  // Clicking the bar opens the information view with that entry selected.
  await bar.click();
  await expect(
    page.getByRole("heading", { name: "Information", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Moon Landing",
  );
});
