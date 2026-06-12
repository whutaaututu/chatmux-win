// ChatMux server tests — file-ops module
// Run: node --test server/test/*.test.js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import os from "node:os";

const TMP = join(os.tmpdir(), `chatmux-test-${randomUUID()}`);

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

// ---- TransferManager ----
describe("TransferManager", () => {
  let tm;

  beforeEach(async () => {
    const mod = await import("../file-ops.js");
    tm = mod.transferManager;
  });

  it("createUploadTask creates pending upload", () => {
    const t = tm.createUploadTask("test.txt", "/tmp", 1024);
    assert.equal(t.type, "upload");
    assert.equal(t.fileName, "test.txt");
    assert.equal(t.totalSize, 1024);
    assert.equal(t.status, "pending");
    assert.equal(t.transferred, 0);
  });

  it("createDownloadTask creates pending download", () => {
    const t = tm.createDownloadTask("file.zip", "/dl", 2048);
    assert.equal(t.type, "download");
    assert.equal(t.fileName, "file.zip");
    assert.equal(t.status, "pending");
  });

  it("updateProgress sets transferring status", () => {
    const t = tm.createUploadTask("x.txt", "/tmp", 100);
    tm.updateProgress(t.id, 50);
    assert.equal(tm.getTask(t.id).transferred, 50);
    assert.equal(tm.getTask(t.id).status, "transferring");
  });

  it("completeTask marks completed", () => {
    const t = tm.createUploadTask("done.txt", "/tmp", 100);
    tm.completeTask(t.id);
    assert.equal(tm.getTask(t.id).status, "completed");
    assert.equal(tm.getTask(t.id).transferred, 100);
  });

  it("failTask records error", () => {
    const t = tm.createUploadTask("fail.txt", "/tmp", 100);
    tm.failTask(t.id, "permission denied");
    assert.equal(tm.getTask(t.id).status, "failed");
    assert.equal(tm.getTask(t.id).error, "permission denied");
  });

  it("getAllTasks returns all active tasks", () => {
    tm.createUploadTask("a.txt", "/tmp", 10);
    tm.createDownloadTask("b.txt", "/tmp", 20);
    assert.ok(tm.getAllTasks().length >= 2);
  });

  it("clearCompleted removes completed/failed immediately", () => {
    const t1 = tm.createUploadTask("ok.txt", "/tmp", 1);
    const t2 = tm.createUploadTask("bad.txt", "/tmp", 1);
    tm.completeTask(t1.id);
    tm.failTask(t2.id, "err");
    tm.clearCompleted();
    const ids = tm.getAllTasks().map(t => t.id);
    assert.ok(!ids.includes(t1.id));
    assert.ok(!ids.includes(t2.id));
  });
});

// ---- FileClipboard ----
describe("FileClipboard", () => {
  let cb;

  beforeEach(async () => {
    const mod = await import("../file-ops.js");
    cb = mod.fileClipboard;
    cb.clear();
  });

  it("copy stores files with operation=copy", () => {
    cb.copy([{ path: "/a/b.txt", name: "b.txt" }]);
    assert.equal(cb.getClipboard().length, 1);
    assert.equal(cb.getClipboard()[0].operation, "copy");
  });

  it("cut stores files with operation=cut", () => {
    cb.cut([{ path: "/a/c.txt", name: "c.txt" }]);
    assert.equal(cb.getClipboard()[0].operation, "cut");
  });

  it("paste copies file to target dir", async () => {
    const src = join(TMP, "src.txt");
    writeFileSync(src, "hello");
    cb.copy([{ path: src, name: "src.txt" }]);
    const results = await cb.paste(TMP);
    assert.equal(results[0].success, true);
    assert.equal(results[0].operation, "copy");
    assert.ok(existsSync(join(TMP, "src.txt")));
  });

  it("paste cut moves file", async () => {
    const src = join(TMP, "move-me.txt");
    writeFileSync(src, "move content");
    cb.cut([{ path: src, name: "move-me.txt" }]);
    const dest = join(TMP, "sub");
    mkdirSync(dest, { recursive: true });
    const results = await cb.paste(dest);
    assert.equal(results[0].success, true);
    assert.equal(results[0].operation, "cut");
    assert.ok(existsSync(join(dest, "move-me.txt")));
    assert.ok(!existsSync(src));
  });

  it("paste auto-renames on collision", async () => {
    const src = join(TMP, "dup.txt");
    writeFileSync(src, "first");
    writeFileSync(join(TMP, "dup.txt"), "existing");
    cb.copy([{ path: src, name: "dup.txt" }]);
    await cb.paste(TMP);
    assert.ok(existsSync(join(TMP, "dup_1.txt")));
  });

  it("clear empties clipboard", () => {
    cb.copy([{ path: "/x", name: "x" }]);
    cb.clear();
    assert.equal(cb.getClipboard().length, 0);
  });
});

// ---- deleteFiles ----
describe("deleteFiles", () => {
  let deleteFiles;

  beforeEach(async () => {
    const mod = await import("../file-ops.js");
    deleteFiles = mod.deleteFiles;
  });

  it("deletes single file", async () => {
    const f = join(TMP, "del.txt");
    writeFileSync(f, "bye");
    const results = await deleteFiles([f]);
    assert.equal(results[0].success, true);
    assert.ok(!existsSync(f));
  });

  it("returns failure for missing file", async () => {
    const results = await deleteFiles([join(TMP, "nope.txt")]);
    assert.equal(results[0].success, false);
  });

  it("batch deletes multiple files", async () => {
    const f1 = join(TMP, "a.txt");
    const f2 = join(TMP, "b.txt");
    writeFileSync(f1, "a");
    writeFileSync(f2, "b");
    const results = await deleteFiles([f1, f2]);
    assert.equal(results.length, 2);
    assert.deepEqual(results.map(r => r.success), [true, true]);
    assert.ok(!existsSync(f1) && !existsSync(f2));
  });
});
