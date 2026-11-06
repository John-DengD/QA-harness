import { expect, type Page } from "@playwright/test";

export interface RoasInput {
  spend: number;
  revenue: number;
  grossMargin: number;
  targetNetMargin: number;
}

export async function calculateWebsiteRoas(page: Page, input: RoasInput): Promise<Record<string, string>> {
  await page.goto("/tools/roas-calculator");
  await expect(page.getByRole("heading", { level: 1, name: /Calculate current, break-even and target ROAS/i }))
    .toBeVisible();
  const form = page.locator("form");
  for (const [label, value] of [
    ["Ad spend", input.spend],
    ["Attributed revenue", input.revenue],
    ["Gross margin", input.grossMargin],
    ["Target net margin", input.targetNetMargin],
  ] as const) {
    await form.getByLabel(label).fill(String(value));
  }
  await form.getByRole("button", { name: "Calculate" }).click();
  return Object.fromEntries(await Promise.all(
    ["Current ROAS", "Break-even ROAS", "Target ROAS"].map(async (label) => [
      label, (await form.getByText(label, { exact: true }).locator("..").innerText()).trim(),
    ])
  ));
}

export async function openWebsiteEventDetail(page: Page, slug: string): Promise<{
  heading: string;
  path: string;
  rsvpVisible: boolean;
}> {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("Invalid event slug");
  await page.goto("/events");
  const link = page.locator(`a[href="/events/${encodeURIComponent(slug)}"]:visible`).first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/events/${slug}(?:[?#]|$)`));
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  return {
    heading: (await heading.innerText()).trim(),
    path: new URL(page.url()).pathname,
    rsvpVisible: await page.getByRole("link", { name: /RSVP/i }).first().isVisible(),
  };
}

export async function inspectWebsiteHomeSeo(page: Page): Promise<{
  heading: string;
  description: string | null;
  title: string;
}> {
  await page.goto("/");
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  return {
    heading: (await heading.innerText()).trim(),
    description: await page.locator('meta[name="description"]').getAttribute("content"),
    title: await page.title(),
  };
}

export async function inspectWebsiteBlogSitemap(page: Page): Promise<{
  articleCount: number;
  blogHeading: string;
  sitemapHasBlog: boolean;
  sitemapValid: boolean;
}> {
  await page.goto("/blog");
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  const sitemapFacts = await page.evaluate(async () => {
    const response = await fetch("/sitemap.xml");
    const source = response.ok ? await response.text() : "";
    const document = new DOMParser().parseFromString(source, "application/xml");
    const valid = document.documentElement.localName === "urlset" &&
      !document.querySelector("parsererror");
    const locations = Array.from(document.getElementsByTagNameNS("*", "loc"), (node) => node.textContent ?? "");
    return { valid: Boolean(valid), hasBlog: locations.some((url) => {
      try { return new URL(url).pathname.startsWith("/blog"); } catch { return false; }
    }) };
  });
  return {
    articleCount: await page.locator('main a[href^="/blog/"]').count(),
    blogHeading: (await heading.innerText()).trim(),
    sitemapHasBlog: sitemapFacts.hasBlog,
    sitemapValid: sitemapFacts.valid,
  };
}
