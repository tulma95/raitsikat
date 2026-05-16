import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Server } from "node:http";
import { createLocalizedIndex } from "./localized-index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

let server: Server;
let url: string;

before(async () => {
  const app = express();
  app.use(createLocalizedIndex({ publicDir }).router);
  server = await new Promise<Server>(r => {
    const s = app.listen(0, () => r(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  url = `http://127.0.0.1:${addr.port}`;
});

after(() => new Promise<void>(r => server.close(() => r())));

describe("localized-index", () => {
  it("/ serves Finnish HTML with correct metadata", async () => {
    const res = await fetch(url + "/");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-language"), "fi");
    const html = await res.text();
    assert.match(html, /<html lang="fi">/);
    assert.match(html, /rel="canonical" href="https:\/\/[^"]+\/"/);
    assert.match(html, /hreflang="fi" href="https:\/\/[^"]+\/"/);
    assert.match(html, /hreflang="en" href="https:\/\/[^"]+\/en"/);
    assert.match(html, /hreflang="x-default" href="https:\/\/[^"]+\/"/);
    assert.match(html, /"inLanguage":\s*"fi"/);
    assert.ok(!html.includes("{{"), "no unresolved {{placeholders}} in HTML");
  });

  it("/en serves English HTML", async () => {
    const res = await fetch(url + "/en");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-language"), "en");
    const html = await res.text();
    assert.match(html, /<html lang="en">/);
    assert.match(html, /"inLanguage":\s*"en"/);
  });

  it("/fi redirects 301 to /", async () => {
    const res = await fetch(url + "/fi", { redirect: "manual" });
    assert.equal(res.status, 301);
    assert.equal(res.headers.get("location"), "/");
  });
});
