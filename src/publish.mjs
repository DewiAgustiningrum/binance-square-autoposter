// src/publish.mjs
// Publishes validated text to Binance Square. Imports square-post's lib.mjs
// directly (it exports its internals, same as the data-fetching skills) —
// no subprocess needed.

import { publish, resolveApiKey } from "../skills/square-post/scripts/lib.mjs";
import { recordPost } from "./validate.mjs";

/**
 * Publish a validated post. Caller is responsible for having already run
 * validatePost() — this function does not re-validate, it just publishes
 * and records history.
 *
 * Returns { id, shareLink, publishStatus }. Note publishStatus can be
 * "success_without_post_id" (upstream 504) — id/shareLink will be null in
 * that case even though the post went through. Don't treat null id as a
 * failure; only a thrown error means the publish actually failed.
 */
export async function publishPost({ theme, text }) {
  const apiKey = resolveApiKey(); // reads BINANCE_SQUARE_OPENAPI_KEY from env

  const result = await publish(apiKey, {
    contentType: 1, // 1 = short post (no title -> not an article)
    bodyTextOnly: text,
  });

  await recordPost({
    theme,
    text,
    postId: result.id,
    shareLink: result.shareLink,
  });

  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = process.argv[2];
  if (!text) {
    console.error("Usage: node src/publish.mjs '<post text>'");
    process.exit(1);
  }
  const result = await publishPost({ theme: "manual-test", text });
  console.log(JSON.stringify(result, null, 2));
}
