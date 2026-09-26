// src/run.mjs
// Entry point called by the GitHub Actions workflow.
// generate -> validate -> publish, with clean skip-not-crash on invalid output.

import { generatePost } from "./generate.mjs";
import { validatePost } from "./validate.mjs";
import { publishPost } from "./publish.mjs";

const MAX_ATTEMPTS = 3;

async function main() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`--- Attempt ${attempt}/${MAX_ATTEMPTS} ---`);

    const { theme, themeLabel, text } = await generatePost();
    console.log(`Theme: ${themeLabel} (${theme})`);
    console.log(`Draft:\n${text}\n`);

    const validation = await validatePost(text, theme);
    if (!validation.valid) {
      console.error(`Validation failed: ${validation.reason}`);
      if (attempt < MAX_ATTEMPTS) {
        console.error("Regenerating...\n");
        continue;
      }
      console.error(`All ${MAX_ATTEMPTS} attempts failed validation. Skipping publish for this run.`);
      process.exitCode = 1; // non-zero so the Actions run shows as failed/flagged
      return;
    }

    const result = await publishPost({ theme, text });
    console.log(`Published on attempt ${attempt}. id=${result.id ?? "n/a"} link=${result.shareLink ?? "n/a"}`);
    return;
  }
}

main().catch((err) => {
  console.error(`Run failed: ${err.stack ?? err.message}`);
  process.exitCode = 1;
});
