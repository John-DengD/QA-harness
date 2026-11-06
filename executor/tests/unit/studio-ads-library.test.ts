import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "@playwright/test";

import {
  continueStudioToStyle,
  observeStudioCreateControls,
  observeStudioLibraryControls,
  observeStudioLibraryRuns,
  openStudioCreateSheet,
  openStudioLibrary,
  openStudioVideoAdBrief,
  prepareStudioReferenceUpload,
  reopenStudioProductBrief,
  returnToStudioLibrary,
  shuffleStudioReferences,
  uploadStudioReference,
} from "../../src/actions/studio-actions";

// Mirrors hellyeah-v2 origin/staging after #1168 (519354555, "Studio is now
// Ads"): screen.tsx PageHeader title "Ads", filters.tsx search label "Search
// ads by name or copy", back.tsx "All Ads", card.tsx "<alt> generating", and
// composer.tsx Confirm (brief-mark) → references row with Upload / Shuffle and
// "Select Reference N" cards instead of Continue To Style.
const adsLibrary = `<!doctype html><title>Hellyeah</title>
<nav><a href="/studio">Ads</a></nav>
<main>
  <section id="library">
    <h2>Ads</h2><p>Create image ads here, then launch them in a campaign.</p>
    <div><input aria-label="Search ads by name or copy" placeholder="Search by ad name or copy…">
      <button role="combobox" aria-label="Filter Sets by State">All</button>
      <button id="create">Create Ads</button></div>
    <div data-slot="studio-set-grid">
      <article><div role="group" aria-label="Square ad image generating">Generating…</div><h2>AI Interview Copilot</h2></article>
      <article><div role="group" aria-label="Landscape ad image ready">img</div><h2>From Practice To Offers</h2></article>
    </div>
  </section>
  <section id="composer" hidden>
    <button id="back">All Ads</button><h2>Create Ads</h2>
    <section data-slot="studio-row-brief" data-state="active">
      <h2>This is what we know about your brand/product</h2>
      <div data-slot="brief-box" data-state="open">
        <textarea aria-label="Key message">Interview copilot for job seekers</textarea>
        <button aria-label="Confirm" data-slot="brief-mark" data-state="open">Confirm</button>
      </div>
    </section>
    <section data-slot="studio-row-references" data-state="upcoming">
      <h2>Now, pick some visual references for your ads</h2>
      <input type="file" accept="image/png,image/jpeg" class="sr-only" tabindex="-1">
      <button aria-label="Upload" disabled>u</button><button aria-label="Shuffle" disabled>s</button>
      <div data-slot="reference-candidates"></div>
    </section>
    <div data-slot="brief-actions"><p role="status"></p><button id="generate" disabled>Generate</button></div>
  </section>
  <section aria-label="Notifications"><ol id="toasts"></ol></section>
</main>
<script>
  const $ = (s) => document.querySelector(s);
  let hand = 0;
  const deal = () => {
    hand += 1;
    $('[data-slot="reference-candidates"]').innerHTML = [1, 2, 3].map((n) =>
      '<button aria-label="Select Reference ' + n + '" aria-pressed="false"><img alt="ref" src="/img/' + hand + '-' + n + '.png"></button>').join('');
  };
  $('#create').onclick = () => { $('#library').hidden = true; $('#composer').hidden = false; };
  $('#back').onclick = () => { $('#library').hidden = false; $('#composer').hidden = true; };
  $('[data-slot="brief-mark"]').onclick = () => {
    $('[data-slot="brief-box"]').dataset.state = 'locked';
    $('[data-slot="brief-mark"]').remove();
    $('[data-slot="studio-row-references"]').dataset.state = 'active';
    $('[aria-label="Upload"]').disabled = false; $('[aria-label="Shuffle"]').disabled = false;
    setTimeout(deal, 50);
  };
  $('textarea').onpointerup = () => {
    if ($('[data-slot="brief-box"]').dataset.state !== 'locked') return;
    $('[data-slot="brief-box"]').dataset.state = 'open';
    $('[data-slot="studio-row-references"]').dataset.state = 'upcoming';
    $('[data-slot="reference-candidates"]').innerHTML = '';
    const mark = document.createElement('button');
    mark.setAttribute('aria-label', 'Confirm'); mark.dataset.slot = 'brief-mark'; mark.textContent = 'Confirm';
    mark.onclick = $('[data-slot="brief-box"]').__confirm;
    $('[data-slot="brief-box"]').append(mark);
  };
  $('[data-slot="brief-box"]').__confirm = $('[data-slot="brief-mark"]').onclick;
  $('[aria-label="Shuffle"]').onclick = () => setTimeout(deal, 50);
  // composer.tsx upload(): the file spins into the first unpicked slot on its
  // local (blob:) preview, picked and busy; importCreativeImage then swaps in
  // the stored image. A failed import toasts and gives the slot back.
  const cards = () => [...document.querySelectorAll('[data-slot="reference-candidates"] button')];
  const syncGenerate = () => {
    const picked = cards().filter((card) => card.getAttribute('aria-pressed') === 'true' && card.getAttribute('aria-busy') !== 'true').length;
    const busy = cards().some((card) => card.getAttribute('aria-busy') === 'true');
    $('#generate').disabled = busy || picked === 0;
    $('#generate').textContent = picked ? 'Generate ' + picked + (picked === 1 ? ' Set' : ' Sets') : 'Generate';
    $('[aria-label="Upload"]').disabled = busy || cards().filter((card) => card.getAttribute('aria-pressed') === 'true').length >= 3;
  };
  $('[aria-label="Upload"]').onclick = () => $('input[type=file]').click();
  $('input[type=file]').onchange = (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    const slot = cards().find((card) => card.getAttribute('aria-pressed') !== 'true');
    const previous = slot.cloneNode(true);
    slot.setAttribute('aria-pressed', 'true'); slot.setAttribute('aria-busy', 'true');
    slot.querySelector('img').alt = file.name; slot.querySelector('img').src = URL.createObjectURL(file);
    syncGenerate();
    setTimeout(() => {
      if (file.name.startsWith('broken')) {
        slot.replaceWith(previous);
        $('#toasts').innerHTML = '<li data-sonner-toast data-type="error">Image upload failed. Try again.</li>';
      } else {
        slot.setAttribute('aria-busy', 'false');
        slot.querySelector('img').src = '/img/stored-' + file.name;
      }
      syncGenerate();
    }, 150);
  };
</script>`;

const videoEntryLibrary = `<!doctype html><title>Hellyeah</title>
<main>
  <section id="library">
    <h2>Ads</h2><button id="create">Create Ads</button>
    <div role="menu" id="choices" hidden>
      <button role="menuitem" id="image">Image ads</button>
      <button role="menuitem" id="video">Video ad</button>
    </div>
  </section>
  <section id="image-sheet" hidden>
    <h2>Create Ads</h2><div data-slot="brief-box"><button data-slot="brief-mark">Confirm</button></div>
  </section>
  <section id="video-sheet" data-slot="studio-video-ad" hidden>
    <h2>Create Video Ad</h2><textarea aria-label="Key message">A useful product brief</textarea>
    <button id="video-confirm">Confirm</button>
  </section>
</main>
<script>
  document.body.dataset.videoStarts = '0';
  document.querySelector('#create').onclick = () => { document.querySelector('#choices').hidden = false; };
  document.querySelector('#image').onclick = () => {
    document.querySelector('#choices').hidden = true;
    document.querySelector('#library').hidden = true;
    document.querySelector('#image-sheet').hidden = false;
  };
  document.querySelector('#video').onclick = () => {
    document.querySelector('#choices').hidden = true;
    document.querySelector('#library').hidden = true;
    document.querySelector('#video-sheet').hidden = false;
  };
  document.querySelector('#video-confirm').onclick = () => {
    document.body.dataset.videoStarts = String(Number(document.body.dataset.videoStarts) + 1);
  };
</script>`;

describe("Studio actions on the Ads library (staging after #1168)", () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    browser = await chromium.launch();
    const context = await browser.newContext({ baseURL: "http://test.local" });
    page = await context.newPage();
    await page.route("http://test.local/studio", (route) => route.fulfill({ contentType: "text/html", body: adsLibrary }));
    await page.route("http://test.local/img/**", (route) => route.fulfill({ contentType: "image/png", body: Buffer.alloc(0) }));
  });
  afterAll(async () => { await browser?.close(); });

  it("opens the library and reads its controls and runs", async () => {
    expect(await openStudioLibrary(page)).toEqual({ createEntryVisible: true, url: "http://test.local/studio" });
    expect(await observeStudioLibraryControls(page)).toEqual({
      headingVisible: true, stateFilterVisible: true, searchVisible: true,
    });
    expect(await observeStudioLibraryRuns(page)).toEqual({ cardCount: 2, generatingCardCount: 1 });
  }, 30_000);

  it("opens the Video ad brief without starting its paid generation", async () => {
    await page.setContent(videoEntryLibrary);
    expect(await openStudioVideoAdBrief(page)).toEqual({
      title: "Create Video Ad", briefText: "A useful product brief", confirmEnabled: true,
    });
    expect(await page.locator("body").getAttribute("data-video-starts")).toBe("0");
    expect(await page.locator("#image-sheet").isVisible()).toBe(false);
  });

  it("selects Image ads from the new menu while keeping the old direct entry compatible", async () => {
    await page.setContent(videoEntryLibrary);
    expect(await openStudioCreateSheet(page)).toEqual({
      continueToStyleEnabled: true, continueToStyleVisible: true, title: "Create Ads",
    });
    expect(await page.locator("#video-sheet").isVisible()).toBe(false);
    await openStudioLibrary(page);
    expect((await openStudioCreateSheet(page)).title).toBe("Create Ads");
  }, 30_000);

  it("confirms the context into reference (style) picks, shuffles, reopens and returns via All Ads", async () => {
    await openStudioLibrary(page);
    expect(await openStudioCreateSheet(page)).toEqual({
      continueToStyleEnabled: true, continueToStyleVisible: true, title: "Create Ads",
    });
    expect(await observeStudioCreateControls(page)).toEqual({ titleVisible: true, continueEnabled: true });
    expect(await continueStudioToStyle(page)).toEqual({
      briefLocked: true, referencesActive: true, referenceCount: 3, shuffleEnabled: true, generateEnabled: false,
    });
    expect(await shuffleStudioReferences(page)).toEqual({ referenceCount: 3, changed: true });
    expect((await reopenStudioProductBrief(page)).locked).toBe(false);
    expect(await returnToStudioLibrary(page)).toEqual({ url: "http://test.local/studio" });
    expect(await page.locator("#composer").isVisible()).toBe(false);
  }, 45_000);

  it("uploads a reference into the first open slot and reads it back picked and stored", async () => {
    await openStudioLibrary(page);
    await openStudioCreateSheet(page);
    await continueStudioToStyle(page);
    expect(await prepareStudioReferenceUpload(page)).toEqual({
      uploadEnabled: true, fileChooserAttached: true, accept: "image/png,image/jpeg", pickedCount: 0,
    });
    expect(await uploadStudioReference(page, "tests/fixtures/studio/sample-upload.png")).toEqual({
      requestedFileName: "sample-upload.png",
      slot: 1,
      selected: true,
      stored: true,
      pickedCount: 1,
      generateEnabled: true,
      generateLabel: "Generate 1 Set",
    });
    expect((await prepareStudioReferenceUpload(page)).pickedCount).toBe(1);
  }, 45_000);

  it("fails with the product's toast when the upload is rejected", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "studio-upload-"));
    const broken = path.join(dir, "broken.png");
    await writeFile(broken, Buffer.from("not a png"));
    await openStudioLibrary(page);
    await openStudioCreateSheet(page);
    await continueStudioToStyle(page);
    await expect(uploadStudioReference(page, broken)).rejects.toThrow(/Image upload failed/);
  }, 45_000);
});
