// src/run.mjs
// Entry point called by the GitHub Actions workflow.
// generate -> validate -> publish, with clean skip-not-crash on invalid output.

import { generatePost } from "./generate.mjs";
import { validatePost } from "./validate.mjs";
import { publishPost } from "./publish.mjs";

async function main() {
  const { theme, themeLabel, text } = await generatePost();
  console.log(`Theme: ${themeLabel} (${theme})`);
  console.log(`Draft:\n${text}\n`);

  const validation = await validatePost(text, theme);
  if (!validation.valid) {
    console.error(`Validation failed: ${validation.reason}`);
    console.error("Skipping publish for this run. No post was sent.");
    process.exitCode = 1; // non-zero so the Actions run shows as failed/flagged
    return;
  }

  const result = await publishPost({ theme, text });
  console.log(`Published. id=${result.id ?? "n/a"} link=${result.shareLink ?? "n/a"}`);
}

main().catch((err) => {
  console.error(`Run failed: ${err.stack ?? err.message}`);
  process.exitCode = 1;
});
