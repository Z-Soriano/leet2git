const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const extension = path.resolve(__dirname, "..");

test("page listener reports Accepted only after a fresh Submit request", async () => {
  const messages = [];
  const window = {
    fetch: async (url) => ({
      ok: true,
      clone: () => ({ json: async () => url.includes("/submit/")
        ? { submission_id: 123 }
        : { state: "SUCCESS", status_code: 10 } }),
    }),
    postMessage: (message) => messages.push(message),
    addEventListener: () => {},
  };
  class XMLHttpRequest {}
  XMLHttpRequest.prototype.open = function () {};
  XMLHttpRequest.prototype.send = function () {};
  const context = {
    window,
    XMLHttpRequest,
    location: { origin: "https://leetcode.com", pathname: "/problems/two-sum/" },
    history: { pushState() {}, replaceState() {} },
    document: { readyState: "complete" },
  };
  vm.runInNewContext(fs.readFileSync(path.join(extension, "page-listener.js"), "utf8"), context);
  await window.fetch("https://leetcode.com/submissions/detail/999/check/");
  await new Promise(setImmediate);
  assert.equal(messages.length, 0);
  await window.fetch("https://leetcode.com/problems/two-sum/submit/", { method: "POST" });
  await new Promise(setImmediate);
  assert.equal(messages.length, 0);
  await window.fetch("https://leetcode.com/submissions/detail/123/check/");
  await new Promise(setImmediate);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, "123");
});

test("opening an old result page or checking an unrelated ID never uploads it", async () => {
  const messages = [];
  const location = { origin: "https://leetcode.com", pathname: "/problems/two-sum/submissions/123/" };
  const window = {
    fetch: async (url) => ({
      ok: true,
      clone: () => ({ json: async () => url.includes("/submit/")
        ? { submission_id: 456 }
        : { status_msg: "Accepted" } }),
    }),
    postMessage: (message) => messages.push(message),
    addEventListener: () => {},
  };
  class XMLHttpRequest {}
  XMLHttpRequest.prototype.open = function () {};
  XMLHttpRequest.prototype.send = function () {};
  vm.runInNewContext(fs.readFileSync(path.join(extension, "page-listener.js"), "utf8"), {
    window, XMLHttpRequest, location,
    history: { pushState() {}, replaceState() {} },
    document: { readyState: "complete" },
  });
  await window.fetch("https://leetcode.com/submissions/detail/123/check/");
  await new Promise(setImmediate);
  assert.equal(messages.length, 0);
  await window.fetch("https://leetcode.com/submissions/detail/456/check/");
  await new Promise(setImmediate);
  assert.equal(messages.length, 0);
  await window.fetch("https://leetcode.com/problems/two-sum/submit/", { method: "POST" });
  await new Promise(setImmediate);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, "456");
});

test("XHR detection also requires a fresh Submit response", () => {
  const messages = [];
  class XMLHttpRequest {
    constructor() { this.listeners = {}; this.status = 200; this.responseType = ""; }
    open(_method, url) { this.url = url; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    send() {
      this.responseText = JSON.stringify(this.url.includes("/submit/")
        ? { submission_id: 777 } : { state: "SUCCESS", status_code: 10 });
      this.listeners.loadend?.();
    }
  }
  const window = { fetch: async () => {}, postMessage: (message) => messages.push(message), addEventListener() {} };
  vm.runInNewContext(fs.readFileSync(path.join(extension, "page-listener.js"), "utf8"), {
    window, XMLHttpRequest,
    location: { origin: "https://leetcode.com", pathname: "/problems/two-sum/" },
    history: { pushState() {}, replaceState() {} },
    document: { readyState: "complete" },
  });
  const old = new XMLHttpRequest();
  old.open("GET", "/submissions/detail/999/check/"); old.send();
  assert.equal(messages.length, 0);
  const submit = new XMLHttpRequest();
  submit.open("POST", "/problems/two-sum/submit/"); submit.send();
  const check = new XMLHttpRequest();
  check.open("GET", "/submissions/detail/777/check/"); check.send();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, "777");
});

test("content script verifies Accepted and retrieves source and question number", async () => {
  let listener;
  const requests = [];
  const chrome = { runtime: { onMessage: { addListener: (fn) => { listener = fn; } } } };
  const fetch = async (_url, options) => {
    requests.push(options);
    const { query } = JSON.parse(options.body);
    return { ok: true, json: async () => ({ data: query.includes("submissionDetails(")
      ? { submissionDetails: { statusCode: 10, code: "print(1)", lang: { name: "python3" }, question: { titleSlug: "two-sum" } } }
      : { question: { questionFrontendId: "1", title: "Two Sum", titleSlug: "two-sum" } },
    }) };
  };
  vm.runInNewContext(fs.readFileSync(path.join(extension, "content.js"), "utf8"), {
    chrome, fetch, setTimeout,
    window: { addEventListener() {} },
    document: { cookie: "csrftoken=csrf-value" },
  });
  const result = await new Promise((resolve) => listener({ type: "GET_SUBMISSION", id: "123" }, {}, resolve));
  assert.equal(result.ok, true);
  assert.equal(result.details.number, "1");
  assert.equal(result.details.code, "print(1)");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers["X-CSRFToken"], "csrf-value");
});

test("worker creates a private repo and saves code plus question details", async () => {
  const stored = {};
  const uploads = [];
  let listener;
  const chrome = {
    runtime: { id: "extension-id", onMessage: { addListener: (fn) => { listener = fn; } } },
    storage: { local: {
      setAccessLevel: async () => {},
      get: async (keys) => Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((key) => [key, stored[key]])
      ),
      set: async (values) => Object.assign(stored, values),
    } },
    tabs: { sendMessage: async () => ({ ok: true, details: {
      accepted: true, id: "123", code: "print('hello')\n", lang: "python3",
      slug: "two-sum", number: "1", title: "Two Sum",
    } }) },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  };
  const reply = (status, data = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
  const fetch = async (url, options = {}) => {
    const method = options.method || "GET";
    if (url.endsWith("/user") && method === "GET") return reply(200, { login: "owner" });
    if (url.endsWith("/repos/owner/leetcode-solutions") && method === "GET") return reply(404);
    if (url.endsWith("/user/repos") && method === "POST") {
      assert.equal(JSON.parse(options.body).private, true);
      assert.equal(JSON.parse(options.body).name, "leetcode-solutions");
      return reply(201, { html_url: "https://github.com/owner/leetcode-solutions" });
    }
    if (url.includes("/contents/") && method === "GET") return reply(404);
    if (url.includes("/contents/") && method === "PUT") {
      uploads.push({ url, body: JSON.parse(options.body) });
      return reply(201);
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  vm.runInNewContext(fs.readFileSync(path.join(extension, "background.js"), "utf8"), {
    chrome, fetch, URL, TextEncoder, btoa, Date, Set, encodeURIComponent,
  });
  const send = (message, sender) => new Promise((resolve) => listener(message, sender, resolve));
  const setup = await send(
    { type: "SAVE_CONFIG", repo: "leetcode-solutions", token: "test-token", enabled: true },
    { id: "extension-id" },
  );
  assert.equal(setup.ok, true);
  const synced = await send(
    { type: "ACCEPTED_CANDIDATE", id: "123" },
    { id: "extension-id", tab: { id: 1 }, frameId: 0, url: "https://leetcode.com/problems/two-sum/" },
  );
  assert.equal(synced.ok, true);
  assert.equal(uploads.length, 2);
  assert.match(uploads[0].url, /solutions\/two-sum\/123\.py$/);
  assert.equal(Buffer.from(uploads[0].body.content, "base64").toString(), "print('hello')\n");
  assert.match(Buffer.from(uploads[1].body.content, "base64").toString(), /# 1\. Two Sum/);
  assert.equal(stored.lastStatus.kind, "uploaded");
  assert.equal(stored.destinationVersion, 2);
});

async function runLegacyDestination(createStatus) {
  const stored = { token: "test-token", owner: "owner", repo: "leet2git", enabled: true, isPublic: false };
  const uploads = [];
  let listener;
  const chrome = {
    runtime: { id: "extension-id", onMessage: { addListener: (fn) => { listener = fn; } } },
    storage: { local: {
      setAccessLevel: async () => {},
      get: async (keys) => Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((key) => [key, stored[key]])
      ),
      set: async (values) => Object.assign(stored, values),
    } },
    tabs: { sendMessage: async () => ({ ok: true, details: {
      accepted: true, id: "123", code: "print(1)", lang: "python3",
      slug: "two-sum", number: "1", title: "Two Sum",
    } }) },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  };
  const reply = (status, data = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
  const fetch = async (url, options = {}) => {
    const method = options.method || "GET";
    assert.doesNotMatch(url, /\/repos\/owner\/leet2git/);
    if (url.endsWith("/repos/owner/leetcode-solutions") && method === "GET") return reply(404);
    if (url.endsWith("/user/repos") && method === "POST") {
      assert.equal(JSON.parse(options.body).name, "leetcode-solutions");
      return reply(createStatus, createStatus === 201
        ? { html_url: "https://github.com/owner/leetcode-solutions" }
        : { message: "Repository creation denied" });
    }
    if (url.includes("/contents/") && method === "GET") return reply(404);
    if (url.includes("/contents/") && method === "PUT") {
      uploads.push(url);
      return reply(201);
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  vm.runInNewContext(fs.readFileSync(path.join(extension, "background.js"), "utf8"), {
    chrome, fetch, URL, TextEncoder, btoa, Date, Set, encodeURIComponent,
  });
  const result = await new Promise((resolve) => listener(
    { type: "ACCEPTED_CANDIDATE", id: "123" },
    { id: "extension-id", tab: { id: 1 }, frameId: 0, url: "https://leetcode.com/problems/two-sum/" },
    resolve,
  ));
  return { stored, uploads, result };
}

test("an existing install migrates the old default before uploading", async () => {
  const { stored, uploads, result } = await runLegacyDestination(201);
  assert.equal(result.ok, true);
  assert.equal(stored.repo, "leetcode-solutions");
  assert.equal(stored.destinationVersion, 2);
  assert.equal(uploads.length, 2);
  assert.ok(uploads.every((url) => url.includes("/repos/owner/leetcode-solutions/")));
});

test("a failed new-repo creation never falls back to the old repo", async () => {
  const { stored, uploads, result } = await runLegacyDestination(403);
  assert.equal(result.ok, false);
  assert.equal(stored.repo, "leet2git");
  assert.equal(uploads.length, 0);
});
