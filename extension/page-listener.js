// Runs in the LeetCode page world so it can see the site's fetch/XHR results.
// Only a numeric submission ID leaves this world; source code is fetched separately.
(() => {
  const submitPath = /\/problems\/[a-z0-9-]+\/submit\/?(?:\?|$)/;
  const checkPath = /\/submissions\/detail\/(\d+)\/(?:v\d+\/)?check\/?(?:\?|$)/;
  const detailPath = /^\/problems\/[a-z0-9-]+\/submissions\/(\d+)\/?/;
  const pendingKey = "leet2git-fresh-submissions";
  const maxAgeMs = 2 * 60 * 1000;
  const submitted = new Map();
  const finishedChecks = new Map();

  function notify(type, details = {}) {
    window.postMessage({ source: "leet2git-page", type, ...details }, location.origin);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source === "leet2git-content" && event.data.type === "PING") {
      notify("LISTENER_READY");
    }
  });

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

  function checkFailed(url, status) {
    const id = String(url || "").match(checkPath)?.[1];
    if (id && fresh(id)) notify("CHECK_FAILED", { id, status });
  }

  function rememberSubmit(body) {
    const id = String(body?.submission_id ?? body?.submissionId ?? "");
    if (!/^\d+$/.test(id)) return false;
    submitted.set(id, Date.now());
    try { sessionStorage.setItem(pendingKey, JSON.stringify([...submitted])); } catch (_) {}
    if (finishedChecks.has(id)) {
      if (finishedChecks.get(id)) emit(id, true);
      else notify("SUBMISSION_RESULT", { id });
    }
    inspectRoute();
    return true;
  }

  function emit(id, confirmed = false) {
    if (!/^\d+$/.test(String(id)) || !fresh(id)) return;
    notify("SUBMISSION", { id: String(id), confirmed });
  }

  function inspectCheck(url, body) {
    const match = String(url || "").match(checkPath);
    if (!match || !body || typeof body !== "object") return;
    if (body.state && body.state !== "SUCCESS") return;
    if (body.status_code == null && typeof body.status_msg !== "string") return;
    const id = match[1];
    if (finishedChecks.has(id)) return;
    const accepted = Number(body.status_code) === 10 || body.status_msg === "Accepted";
    finishedChecks.set(id, accepted);
    if (!fresh(id)) return;
    if (accepted) emit(id, true);
    else notify("SUBMISSION_RESULT", { id });
  }

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
    const method = String(args[1]?.method || args[0]?.method || "GET").toUpperCase();
    const isSubmit = method === "POST" && submitPath.test(String(url || ""));
    const isCheck = checkPath.test(String(url || ""));
    if (isSubmit) notify("SUBMIT_STARTED");
    let promise;
    try { promise = originalFetch.apply(this, args); }
    catch (error) {
      if (isSubmit) notify("SUBMIT_FAILED");
      if (isCheck) checkFailed(url);
      throw error;
    }
    if (!isSubmit && !isCheck) return promise;
    return promise.then((response) => {
      if (response.ok) {
        response.clone().json().then((body) => {
          if (isSubmit && !rememberSubmit(body)) notify("SUBMIT_FAILED");
          if (isCheck) inspectCheck(url, body);
        }).catch(() => {
          if (isSubmit) notify("SUBMIT_FAILED");
          if (isCheck) checkFailed(url);
        });
      } else if (isSubmit) notify("SUBMIT_FAILED", { status: response.status });
      else if (isCheck) checkFailed(url, response.status);
      return response;
    }, (error) => {
      if (isSubmit) notify("SUBMIT_FAILED");
      if (isCheck) checkFailed(url);
      throw error;
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
    if (isSubmit) notify("SUBMIT_STARTED");
    if (isSubmit || isCheck) {
      this.addEventListener("loadend", () => {
        try {
          if (this.status < 200 || this.status >= 300) {
            if (isSubmit) notify("SUBMIT_FAILED", { status: this.status });
            if (isCheck) checkFailed(this.__leet2gitUrl, this.status);
            return;
          }
          const body = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
          if (isSubmit && !rememberSubmit(body)) notify("SUBMIT_FAILED");
          if (isCheck) inspectCheck(this.__leet2gitUrl, body);
        } catch (_) {
          if (isSubmit) notify("SUBMIT_FAILED");
          if (isCheck) checkFailed(this.__leet2gitUrl);
        }
      }, { once: true });
    }
    try { return originalSend.apply(this, args); }
    catch (error) {
      if (isSubmit) notify("SUBMIT_FAILED");
      if (isCheck) checkFailed(this.__leet2gitUrl);
      throw error;
    }
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
