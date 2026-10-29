const { chromium } = require("playwright");
const fs = require("fs");

const pages = {
  gas: "https://www.iexitapp.com/gasprices/California/4/Redding/3049/Unleaded/3?r=10",
  diesel: "https://www.iexitapp.com/gasprices/California/4/Redding/3049/Diesel/1?r=10"
};

async function getPrices(page, url, fuel) {
  console.log(`Loading ${fuel}: ${url}`);

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  // Give Cloudflare/page rendering a chance to finish.
  await page.waitForTimeout(5000);

  const title = await page.title();
  console.log(`${fuel} page title: ${title}`);

  if (title.toLowerCase().includes("just a moment")) {
    throw new Error(`Cloudflare challenge blocked ${fuel}`);
  }

  const text = await page.locator("body").innerText();

  // Normalize iExit's separate 9/10 digit:
  // $5.19 9 -> $5.199
  const normalized = text.replace(
    /\$(\d+\.\d{2})\s+([0-9])(?=\s|$)/g,
    (_, price, digit) => `$${price}${digit}`
  );

  // Find the summary section.
  const summaryMatch = normalized.match(
    /Lowest[\s\S]{0,300}?Average[\s\S]{0,300}?Highest[\s\S]{0,1000}/i
  );

  if (!summaryMatch) {
    throw new Error(`Summary section not found for ${fuel}`);
  }

  const summary = summaryMatch[0];

  const prices = [
    ...summary.matchAll(/\$\s*(\d+\.\d{2,3})/g)
  ].map(m => Number(m[1]));

  if (prices.length < 3) {
    throw new Error(`Could not find three prices for ${fuel}`);
  }

  const countMatch = normalized.match(
    /Across\s+(\d+)\s+gas stations/i
  );

  const result = {
    low: prices[0],
    avg: prices[1],
    high: prices[2],
    stations: countMatch ? Number(countMatch[1]) : null
  };

  if (
    result.low > result.avg ||
    result.avg > result.high ||
    result.low < 1 ||
    result.high > 15
  ) {
    throw new Error(`Price sanity check failed for ${fuel}`);
  }

  console.log(`${fuel}:`, result);

  return result;
}

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  try {
    const context = await browser.newContext({
      locale: "en-US",
      timezoneId: "America/Los_Angeles"
    });

    const page = await context.newPage();

    const gas = await getPrices(page, pages.gas, "gas");
    const diesel = await getPrices(page, pages.diesel, "diesel");

    const output = {
      location: "Redding, CA",
      radius_miles: 10,
      source: "iExit",
      gas,
      diesel,
      updated: new Date().toISOString()
    };

    fs.writeFileSync(
      "fuel-prices.json",
      JSON.stringify(output, null, 2)
    );

    console.log("fuel-prices.json created:");
    console.log(JSON.stringify(output, null, 2));

  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
