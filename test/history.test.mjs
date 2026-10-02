import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadHistory, recordPost, updatePost, getRecentThemes, validatePost, HistoryError } from "../src/validate.mjs";
import { useTempHistory } from "./helpers.mjs";

test("missing file means empty history (first run)", async () => {
  await useTempHistory();
  assert.deepEqual(await loadHistory(), []);
});

test("corrupt JSON is a hard error, not an empty history", async () => {
  await useTempHistory('[{"theme": "daily-recap", "te');
  await assert.rejects(loadHistory(), HistoryError);
  await assert.rejects(getRecentThemes(4), HistoryError);
  await assert.rejects(validatePost("$BTC held $84,750 today and volume stayed active all session.", "morning-brief"), HistoryError);
});

test("recordPost on a corrupt file refuses and does NOT overwrite it", async () => {
  const h = await useTempHistory('[{"theme": "x", "te');
  const before = await readFile(h.file, "utf-8");
  await assert.rejects(recordPost({ theme: "daily-recap", text: "t".repeat(50) }), HistoryError);
  assert.equal(await readFile(h.file, "utf-8"), before);
});

test("wrong shapes are rejected", async () => {
  await useTempHistory('{"oops": 1}');
  await assert.rejects(loadHistory(), /JSON array/);
  await writeFile(process.env.HISTORY_PATH, '[{"theme": "x"}]');
  await assert.rejects(loadHistory(), /entry 0 is malformed/);
});

test("write is atomic: no temp files left behind, content round-trips", async () => {
  const h = await useTempHistory();
  const entry = await recordPost({ theme: "daily-recap", text: "hello world ".repeat(5), status: "pending" });
  assert.deepEqual((await readdir(h.dir)).sort(), ["posts.json"]);
  assert.equal((await h.read())[0].id, entry.id);
});

test("updatePost patches by id; unknown id throws", async () => {
  const h = await useTempHistory();
  const entry = await recordPost({ theme: "daily-recap", text: "a".repeat(50), status: "pending" });
  await updatePost(entry.id, { status: "published", postId: 42 });
  const [stored] = await h.read();
  assert.equal(stored.status, "published");
  assert.equal(stored.postId, 42);
  await assert.rejects(updatePost("nope", {}), HistoryError);
});

test("history is capped at 30, newest first", async () => {
  const h = await useTempHistory();
  for (let i = 0; i < 33; i++) await recordPost({ theme: "daily-recap", text: `post ${i} `.repeat(10) });
  const all = await h.read();
  assert.equal(all.length, 30);
  assert.match(all[0].text, /post 32/);
});

test("failed posts don't count as a used theme; legacy entries without status do", async () => {
  await useTempHistory([
    { theme: "a", text: "x", date: "d", status: "failed" },
    { theme: "b", text: "x", date: "d" }, // legacy entry, no status
    { theme: "c", text: "x", date: "d", status: "unknown" },
  ]);
  assert.deepEqual(await getRecentThemes(4), ["b", "c"]);
});

test("history path does not depend on cwd", async () => {
  delete process.env.HISTORY_PATH;
  const here = process.cwd();
  process.chdir("/tmp");
  try {
    const h = await loadHistory();
    assert.ok(Array.isArray(h));
    assert.ok(h.length > 0, "should read the repo's data/posts.json, not /tmp/data/posts.json");
  } finally {
    process.chdir(here);
  }
});
