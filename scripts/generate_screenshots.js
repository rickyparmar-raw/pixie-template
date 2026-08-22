const { firefox } = require('playwright');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:8080';
const SCREENSHOTS_DIR = path.join(__dirname, '../public/screenshots');

['shop-purchase', 'submit-project', 'customize-character'].forEach(dir => {
  fs.mkdirSync(path.join(SCREENSHOTS_DIR, dir), { recursive: true });
});

async function saveWebp(pngBuffer, cropRect, outputPath) {
  let pipeline = sharp(pngBuffer);
  if (cropRect) {
    pipeline = pipeline.extract(cropRect);
  }
  const webpBuffer = await pipeline.webp({ quality: 85 }).toBuffer();
  fs.writeFileSync(outputPath, webpBuffer);
  console.log(`Saved ${path.relative(process.cwd(), outputPath)} (${webpBuffer.length} bytes, crop: ${cropRect ? cropRect.width + 'x' + cropRect.height : 'full'})`);
}

async function main() {
  console.log('Launching headless Firefox browser...');
  const browser = await firefox.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1
  });

  // Inject token & fetch mock interceptor before page scripts run
  await context.addInitScript(() => {
    try {
      localStorage.setItem('pixl_token', 'demo-token-12345');
    } catch (e) {}

    const origFetch = window.fetch;
    window.fetch = async function (url, opts) {
      const u = String(url);
      if (u.includes('/api/shop/items')) {
        return new Response(JSON.stringify({
          items: [
            { id: 1, name: "Orpheus Plushie", description: "The official Hack Club dinosaur plushie. Super soft 100% cotton.", price: 450, image_url: "https://assets.hackclub.com/dino.png", unlock_xp: 0, limited: true },
            { id: 2, name: "Mechanical Switch Pack", description: "Pack of 70x Gateron Yellow switches for custom macropad builds.", price: 250, image_url: "", unlock_xp: 0 },
            { id: 3, name: "Holographic Sticker Pack", description: "5 high quality vinyl holographic stickers for your laptop.", price: 100, image_url: "", unlock_xp: 0 },
            { id: 4, name: "Seeed Studio XIAO RP2040", description: "Tiny microcontroller board perfect for hardware projects.", price: 300, image_url: "", unlock_xp: 0 }
          ],
          xp: 150,
          claimed: [],
          region: "US"
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u.includes('/api/wallet')) {
        return new Response(JSON.stringify({ pixels: 1250 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u.includes('/api/profile/eligibility')) {
        return new Response(JSON.stringify({
          ok: true, birthday: '2007-04-12', addressLine1: '860 Howard St', addressCity: 'San Francisco', addressState: 'CA', addressCountry: 'US', addressPostal: '94103', hasAddress: true
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u.includes('/api/shop/orders')) {
        return new Response(JSON.stringify({
          orders: [
            { id: 1, item_name: "Orpheus Plushie", price: 450, quantity: 1, status: "ordered", option: "Original Dino", created_at: new Date().toISOString() }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u.includes('/api/projects')) {
        return new Response(JSON.stringify({
          projects: [
            { id: 101, name: "Hackpad Macropad", description: "A custom 3-key PCB macropad built with KiCad and Fusion360.", repo_url: "https://github.com/demo/hackpad", hours: 12.5, status: "IN REVIEW", created_at: "2026-08-15T10:00:00Z" }
          ],
          hours: 12.5
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return origFetch.apply(this, arguments);
    };
  });

  const page = await context.newPage();

  // ==========================================
  // 1. SHOP-PURCHASE SCREENSHOTS
  // ==========================================
  console.log('\n--- Capturing shop-purchase screenshots ---');

  // Step 1: Open Shop tab (shop-purchase/01.webp)
  await page.goto(`${BASE_URL}/shop/?preview=1&token=demo-token-12345`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  let png = await page.screenshot();
  await saveWebp(png, { left: 140, top: 0, width: 1000, height: 260 }, path.join(SCREENSHOTS_DIR, 'shop-purchase/01.webp'));

  // Step 2: Browse items (shop-purchase/02.webp)
  await page.waitForSelector('#items .card', { timeout: 10000 });
  png = await page.screenshot();
  await saveWebp(png, { left: 140, top: 160, width: 1000, height: 560 }, path.join(SCREENSHOTS_DIR, 'shop-purchase/02.webp'));

  // Step 3: Item detail & Buy button (shop-purchase/03.webp)
  await page.goto(`${BASE_URL}/shop/item/?id=1&preview=1&token=demo-token-12345`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#detail', { timeout: 10000 });
  png = await page.screenshot();
  await saveWebp(png, { left: 140, top: 40, width: 1000, height: 580 }, path.join(SCREENSHOTS_DIR, 'shop-purchase/03.webp'));

  // Step 4: Inventory / Orders (shop-purchase/04.webp)
  await page.goto(`${BASE_URL}/orders/?preview=1&token=demo-token-12345`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#list .order', { timeout: 10000 });
  png = await page.screenshot();
  await saveWebp(png, { left: 140, top: 20, width: 1000, height: 380 }, path.join(SCREENSHOTS_DIR, 'shop-purchase/04.webp'));

  // ==========================================
  // 2. SUBMIT-PROJECT SCREENSHOTS
  // ==========================================
  console.log('\n--- Capturing submit-project screenshots ---');

  // Step 1: Projects page open (submit-project/01.webp)
  await page.goto(`${BASE_URL}/projects/?preview=1&token=demo-token-12345`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.hero', { timeout: 10000 });
  png = await page.screenshot();
  await saveWebp(png, { left: 140, top: 0, width: 1000, height: 260 }, path.join(SCREENSHOTS_DIR, 'submit-project/01.webp'));

  // Step 2: Submit button highlight (submit-project/02.webp)
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('a, button'));
    const submitBtn = btns.find(b => b.textContent.includes('SUBMIT') || b.textContent.includes('Submit'));
    if (submitBtn) {
      submitBtn.style.outline = '3px solid #f59e0b';
      submitBtn.style.outlineOffset = '3px';
      submitBtn.style.boxShadow = '0 0 14px #f59e0b';
    }
  });
  png = await page.screenshot();
  await saveWebp(png, { left: 140, top: 0, width: 1000, height: 240 }, path.join(SCREENSHOTS_DIR, 'submit-project/02.webp'));

  // Step 3: Fill project form (submit-project/03.webp)
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('a, button'));
    const submitBtn = btns.find(b => b.textContent.includes('SUBMIT') || b.textContent.includes('Submit'));
    if (submitBtn) submitBtn.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const nameInp = document.querySelector('input[placeholder*="Name"], input#name, input#title, .form-grid input');
    if (nameInp) nameInp.value = "Hackpad Macropad";
    const descInp = document.querySelector('textarea');
    if (descInp) descInp.value = "A custom 3-key PCB macropad built with KiCad and Fusion360.";
  });
  png = await page.screenshot();
  await saveWebp(png, { left: 140, top: 120, width: 1000, height: 560 }, path.join(SCREENSHOTS_DIR, 'submit-project/03.webp'));

  // Step 4: Hackatime hours & settings (submit-project/04.webp)
  await page.evaluate(() => {
    window.scrollTo(0, 300);
  });
  await page.waitForTimeout(200);
  png = await page.screenshot();
  await saveWebp(png, { left: 140, top: 180, width: 1000, height: 540 }, path.join(SCREENSHOTS_DIR, 'submit-project/04.webp'));

  // Step 5: Submitted project queue (submit-project/05.webp)
  await page.goto(`${BASE_URL}/projects/?preview=1&token=demo-token-12345`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.proj-rows, .proj-row, .grid', { timeout: 10000 });
  png = await page.screenshot();
  await saveWebp(png, { left: 140, top: 180, width: 1000, height: 400 }, path.join(SCREENSHOTS_DIR, 'submit-project/05.webp'));

  // ==========================================
  // 3. CUSTOMIZE-CHARACTER SCREENSHOTS
  // ==========================================
  console.log('\n--- Capturing customize-character screenshots ---');

  // Step 1: Character menu / account hero (customize-character/01.webp)
  await page.goto(`${BASE_URL}/account/?preview=1&token=demo-token-12345`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.hero', { timeout: 10000 });
  png = await page.screenshot();
  await saveWebp(png, { left: 140, top: 0, width: 1000, height: 240 }, path.join(SCREENSHOTS_DIR, 'customize-character/01.webp'));

  // Step 2: Customization options / fields (customize-character/02.webp)
  png = await page.screenshot();
  await saveWebp(png, { left: 140, top: 140, width: 1000, height: 540 }, path.join(SCREENSHOTS_DIR, 'customize-character/02.webp'));

  // Step 3: Save button & status (customize-character/03.webp)
  await page.click('#save-address');
  await page.waitForTimeout(200);
  png = await page.screenshot();
  await saveWebp(png, { left: 140, top: 220, width: 1000, height: 380 }, path.join(SCREENSHOTS_DIR, 'customize-character/03.webp'));

  await browser.close();
  console.log('\n🎉 All screenshots generated successfully with Firefox!');
}

main().catch(err => {
  console.error('Error generating screenshots:', err);
  process.exit(1);
});
