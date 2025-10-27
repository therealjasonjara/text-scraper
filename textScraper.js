import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Define __dirname manually for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Auto-scroll through the entire page to trigger lazy-loading and animations
 */
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100; // Scroll 100px at a time
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          // Scroll back to top
          window.scrollTo(0, 0);
          resolve();
        }
      }, 100); // Scroll every 100ms
    });
  });

  // Wait a bit for any animations/counters to complete
  await page.waitForTimeout(1000);
  console.log(`    ✓ Scrolling complete`);
}

/**
 * Check if a line contains JavaScript/jQuery code
 */
function isJavaScriptLine(line) {
  const jsPatterns = [
    /^(var|let|const|function|if|else|for|while|return|class)\s/,
    /jQuery|^\$\(|\.ready\(/,
    /\.ajax\(|\.get\(|\.post\(/,
    /console\.(log|error|warn)/,
    /document\.(getElementById|querySelector|addEventListener)/,
    /window\.(location|addEventListener|setTimeout)/,
    /\.then\(|\.catch\(|async\s|await\s/,
    /^function\s*\(/,
    /=>\s*{/,
    /^\{.*\}$/,
    /^}$/,
    /;\s*$/,
  ];

  return jsPatterns.some((pattern) => pattern.test(line));
}

/**
 * Expand all accordions on the page
 */
async function expandAccordions(page) {
  try {
    // Common Elementor accordion selectors
    const accordionSelectors = [
      ".elementor-accordion .elementor-tab-title",
      ".elementor-toggle .elementor-tab-title",
      "[data-accordion] .accordion-title",
      ".accordion-item .accordion-header",
      ".elementor-accordion-item .elementor-tab-title",
    ];

    let totalExpanded = 0;

    for (const selector of accordionSelectors) {
      const accordionTitles = await page.$$(selector);

      // Skip if no accordions found with this selector
      if (!accordionTitles || accordionTitles.length === 0) {
        continue;
      }

      for (const title of accordionTitles) {
        try {
          // Check if it's collapsed (aria-expanded="false" or not active)
          const isExpanded = await title.evaluate((el) => {
            const ariaExpanded = el.getAttribute("aria-expanded");
            const isActive = el.classList.contains("elementor-active");
            return ariaExpanded === "true" || isActive;
          });

          if (!isExpanded) {
            await title.click();
            totalExpanded++;
            await page.waitForTimeout(200); // Wait for animation
          }
        } catch (e) {
          // Skip if click fails
        }
      }
    }

    if (totalExpanded > 0) {
      console.log(`    ✓ Expanded ${totalExpanded} accordion(s)`);
    } else {
      console.log(`    ℹ️ No accordions found on this page`);
    }
  } catch (error) {
    console.log(`    ⚠️ Error expanding accordions: ${error.message}`);
  }
}

/**
 * Process all tabs by clicking through them
 */
async function processAllTabs(page) {
  try {
    // Common Elementor tab selectors
    const tabSelectors = [
      ".elementor-tabs .elementor-tab-title",
      ".elementor-tabs-wrapper .elementor-tab-title",
      "[role='tablist'] [role='tab']",
      ".elementor-widget-tabs .elementor-tab-title",
    ];

    let totalTabs = 0;

    for (const selector of tabSelectors) {
      const tabs = await page.$$(selector);

      // Skip if no tabs found with this selector
      if (!tabs || tabs.length === 0) {
        continue;
      }

      console.log(
        `    ℹ️ Found ${tabs.length} tabs with selector: ${selector}`
      );

      for (let i = 0; i < tabs.length; i++) {
        try {
          // Re-query the tab to avoid stale element reference
          const currentTabs = await page.$$(selector);
          if (currentTabs[i]) {
            await currentTabs[i].click();
            totalTabs++;
            await page.waitForTimeout(300); // Wait for tab content to load
          }
        } catch (e) {
          console.log(`    ⚠️ Could not click tab ${i + 1}: ${e.message}`);
        }
      }
    }

    if (totalTabs > 0) {
      console.log(`    ✓ Clicked through ${totalTabs} tab(s)`);
    } else {
      console.log(`    ℹ️ No tabs found on this page`);
    }
  } catch (error) {
    console.log(`    ⚠️ Error processing tabs: ${error.message}`);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const outputDir = path.join(__dirname, "scraped_text");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`📁 Created output directory: ${outputDir}`);
  }

  // Array to track failed URLs
  const failedUrls = [];

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

      // Wait a bit for any dynamic content to load
      await page.waitForTimeout(1000);

      // Scroll through the entire page to trigger lazy-loading and animations
      console.log(`  📜 Scrolling through page to load all content...`);
      await autoScroll(page);

      // 1) Look for the <div> with Elementor type "wp-page" or "single-post"
      let contentHandle = await page.$("div[data-elementor-type='wp-page']");

      if (!contentHandle) {
        contentHandle = await page.$("div[data-elementor-type='single-post']");
      }

      if (!contentHandle) {
        console.log(
          `⚠️ No matching <div data-elementor-type='wp-page'> or <div data-elementor-type='single-post'> found on ${url}`
        );
        failedUrls.push({
          url: url,
          reason: "No matching Elementor div found",
        });
        continue;
      }

      // 2) EXPAND ALL ACCORDIONS
      console.log(`  📂 Expanding accordions...`);
      await expandAccordions(page);

      // 3) CLICK THROUGH ALL TABS
      console.log(`  📑 Processing tabs...`);
      await processAllTabs(page);

      // 4) Extract all text after expansions
      const contentText = await contentHandle.evaluate((el) => {
        // Remove script and style tags first
        const clone = el.cloneNode(true);
        const scripts = clone.querySelectorAll("script, style, noscript");
        scripts.forEach((s) => s.remove());

        // Remove header and footer elements
        const headers = clone.querySelectorAll(
          "header, [role='banner'], .header, #header, .site-header"
        );
        headers.forEach((h) => h.remove());

        const footers = clone.querySelectorAll(
          "footer, [role='contentinfo'], .footer, #footer, .site-footer"
        );
        footers.forEach((f) => f.remove());

        // Remove sections that are hidden on all devices
        const hiddenSections = clone.querySelectorAll(
          ".elementor-hidden-desktop.elementor-hidden-tablet.elementor-hidden-mobile"
        );
        hiddenSections.forEach((section) => section.remove());

        // Use textContent to get ALL text including hidden elements
        return clone.textContent;
      });

      // 5) Convert into lines and filter out JavaScript/jQuery
      const lines = contentText
        .split(/\r?\n/) // Split on new line
        .map((line) => line.trim()) // Trim whitespace
        .filter((line) => line.length > 0) // Remove empty lines
        .filter((line) => !isJavaScriptLine(line)); // Remove JS/jQuery lines

      if (lines.length === 0) {
        console.log(`⚠️ No visible text found in content div on ${url}`);
        failedUrls.push({
          url: url,
          reason: "No visible text found",
        });
        continue;
      }

      // 6) Create a safe filename
      const urlObj = new URL(url);
      let pagePath = urlObj.pathname
        .replace(/\//g, "_")
        .replace(/^_+|_+$/g, ""); // Remove leading/trailing underscores
      if (pagePath === "") pagePath = "homepage"; // Handle homepage

      const filePath = path.join(outputDir, `ennovi_${pagePath}_content.csv`);

      // 7) Convert lines to CSV with proper UTF-8 encoding
      // Add BOM (Byte Order Mark) for proper UTF-8 recognition in Excel
      const BOM = "\uFEFF";
      const csvContent = `${BOM}"Extracted Text"\n${lines
        .map((text) => `"${text.replace(/"/g, '""')}"`)
        .join("\n")}`;

      fs.writeFileSync(filePath, csvContent, "utf8");

      console.log(`✅ Scraping completed! Data saved in ${filePath}`);
      console.log(`  📊 Extracted ${lines.length} lines of text`);
    } catch (error) {
      console.log(`❌ Failed to access ${url}: ${error.message}`);
      failedUrls.push({
        url: url,
        reason: error.message,
      });
      continue;
    }
  }

  // Write failed URLs log file
  if (failedUrls.length > 0) {
    const logFilePath = path.join(outputDir, "failed_scrapes.txt");
    const logContent =
      `Failed to scrape ${failedUrls.length} URL(s):\n\n` +
      failedUrls
        .map((item) => `URL: ${item.url}\nReason: ${item.reason}\n`)
        .join("\n");

    fs.writeFileSync(logFilePath, logContent, "utf8");
    console.log(`\n📋 Failed scrapes log saved to: ${logFilePath}`);
  } else {
    console.log(`\n✅ All pages scraped successfully!`);
  }

  await browser.close();
})();
