// Runs in the LeetCode page world so it can see the site's fetch/XHR results.
// Only a numeric submission ID leaves this world; source code is fetched separately.
(() => {
  const submitPath = /\/problems\/[a-z0-9-]+\/submit\/?(?:\?|$)/;
  const checkPath = /\/submissions\/detail\/(\d+)\/(?:v\d+\/)?check\/?(?:\?|$)/;
  const detailPath = /^\/problems\/[a-z0-9-]+\/submissions\/(\d+)\/?/;
  const pendingKey = "leet2git-fresh-submissions";
  const maxAgeMs = 2 * 60 * 1000;
  const submitted = new Map();
  const acceptedChecks = new Set();

  // Keep only newly submitted IDs across a same-tab page reload. Old result
  // pages have no matching ID and cannot trigger a sync.
  try {
    const saved = JSON.parse(sessionStorage.getItem(pendingKey) || "[]");
    if (Array.isArray(saved)) {
      for (const [id, time] of saved) {
        if (/^\d+$/.test(String(id)) && Date.now() - time < maxAgeMs) {
          submitted.set(String(id), time);
        }
      }
    }
  } catch (_) { /* Session storage may be unavailable. */ }

  function fresh(id) {
    for (const [key, time] of submitted) {
      if (Date.now() - time >= maxAgeMs) submitted.delete(key);
    }
    return submitted.has(String(id));
  }

  function rememberSubmit(body) {
    const id = String(body?.submission_id ?? body?.submissionId ?? "");
    if (!/^\d+$/.test(id)) return;
    submitted.set(id, Date.now());
    try { sessionStorage.setItem(pendingKey, JSON.stringify([...submitted])); } catch (_) {}
    if (acceptedChecks.has(id)) emit(id);
    inspectRoute();
  }

  function emit(id) {
    if (!/^\d+$/.test(String(id)) || !fresh(id)) return;
    window.postMessage({ source: "leet2git-page", type: "SUBMISSION", id: String(id) }, location.origin);
  }

  function inspectCheck(url, body) {
    const match = String(url || "").match(checkPath);
    if (!match || !body || typeof body !== "object") return;
    if (body.state && body.state !== "SUCCESS") return;
    if (Number(body.status_code) === 10 || body.status_msg === "Accepted") {
      acceptedChecks.add(match[1]);
      emit(match[1]);
    }
  }

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
    const method = String(args[1]?.method || args[0]?.method || "GET").toUpperCase();
    const isSubmit = method === "POST" && submitPath.test(String(url || ""));
    const isCheck = checkPath.test(String(url || ""));
    const promise = originalFetch.apply(this, args);
    if (!isSubmit && !isCheck) return promise;
    return promise.then((response) => {
      if (response.ok) {
        response.clone().json().then((body) => {
          if (isSubmit) rememberSubmit(body);
          if (isCheck) inspectCheck(url, body);
        }).catch(() => {});
      }
      return response;
    });
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__leet2gitMethod = String(method || "").toUpperCase();
    this.__leet2gitUrl = String(url || "");
    return originalOpen.call(this, method, url, ...rest);
  };
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    const isSubmit = this.__leet2gitMethod === "POST" && submitPath.test(this.__leet2gitUrl || "");
    const isCheck = checkPath.test(this.__leet2gitUrl || "");
    if (isSubmit || isCheck) {
      this.addEventListener("loadend", () => {
        try {
          if (this.status < 200 || this.status >= 300) return;
          const body = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
          if (isSubmit) rememberSubmit(body);
          if (isCheck) inspectCheck(this.__leet2gitUrl, body);
        } catch (_) { /* Ignore non-JSON responses. */ }
      }, { once: true });
    }
    return originalSend.apply(this, args);
  };

  // A result-page route is considered only for an ID returned by a fresh
  // Submit request; opening an older result page does nothing.
  function inspectRoute() {
    const match = location.pathname.match(detailPath);
    if (match && fresh(match[1])) emit(match[1]);
  }
  for (const name of ["pushState", "replaceState"]) {
    const original = history[name];
    history[name] = function (...args) {
      const result = original.apply(this, args);
      inspectRoute();
      return result;
    };
  }
  window.addEventListener("popstate", inspectRoute);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inspectRoute, { once: true });
  } else {
    inspectRoute();
  }
})();
