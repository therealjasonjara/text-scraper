import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Define __dirname manually for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const outputDir = path.join(__dirname, "scraped_text");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`📁 Created output directory: ${outputDir}`);
  }

  // List of websites to scrape (loaded from websites.txt)
  const listPath = path.join(__dirname, "websites.txt");
  let websites = [];
  try {
    const fileContent = fs.readFileSync(listPath, "utf8");
    websites = fileContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
  } catch (err) {
    console.log(`websites.txt not found or unreadable at ${listPath}`);
  }

  if (websites.length === 0) {
    console.log(
      "No websites to scrape. Ensure websites.txt contains at least one URL."
    );
    await browser.close();
    return;
  }

  for (const url of websites) {
    try {
      console.log(`🔄 Scraping: ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 });

      // 1) Look for the <div> with Elementor post type "page" or "elementor_library"
      let contentHandle = await page.$("div[data-elementor-post-type='page']");

      if (!contentHandle) {
        // If not found, try elementor_library
        contentHandle = await page.$(
          "div[data-elementor-post-type='elementor_library']"
        );
      }

      if (!contentHandle) {
        console.log(
          `⚠️ No matching <div data-elementor-post-type> found on ${url}`
        );
        continue;
      }

      // 2) Extract *all* user-visible text from that <div> as a single string
      const contentText = await contentHandle.evaluate((el) => el.innerText);

      // 3) Convert into lines (splitting by new line)
      const lines = contentText
        .split(/\r?\n/) // Split on new line
        .map((line) => line.trim()) // Trim whitespace
        .filter((line) => line.length > 0); // Remove empty lines

      if (lines.length === 0) {
        console.log(`⚠️ No visible text found in <div id="content"> on ${url}`);
        continue;
      }

      // 4) Create a safe filename
      const urlObj = new URL(url);
      let pagePath = urlObj.pathname
        .replace(/\//g, "_")
        .replace(/^_+|_+$/g, ""); // Remove leading/trailing underscores
      if (pagePath === "") pagePath = "homepage"; // Handle homepage

      const filePath = path.join(
        outputDir,
        `interplex_${pagePath}_content.csv`
      );

      // 5) Convert lines to CSV
      const csvContent = `"Extracted Text"\n${lines
        .map((text) => `"${text.replace(/"/g, '""')}"`)
        .join("\n")}`;

      fs.writeFileSync(filePath, csvContent, "utf8");

      console.log(`✅ Scraping completed! Data saved in ${filePath}`);
    } catch (error) {
      console.log(`❌ Failed to access ${url}: ${error.message}`);
      continue;
    }
  }

  await browser.close();
})();
