"use strict";

const api = globalThis.GitLabReviewers;
const CONTENT_SCRIPT_ID = "gitlab-assign-reviewers";

async function loadSettings() {
  const stored = await browser.storage.local.get(api.STORAGE_KEYS);
  return api.settingsFromStorage(stored);
}

function humanize(error) {
  const text = String(error && error.message ? error.message : error);
  if (/permission|missing host|not allowed/i.test(text)) {
    return "Allow access to your GitLab site from the extension settings, then try again.";
  }
  return text || "Could not add reviewers.";
}

async function requestWithToken(url, method, token, jsonBody) {
  const headers = { Accept: "application/json", "PRIVATE-TOKEN": token };
  const init = { method, headers, cache: "no-store", credentials: "omit" };
  if (jsonBody != null) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(jsonBody);
  }

  try {
    const response = await fetch(url, init);
    return { ok: response.ok, status: response.status, text: await response.text() };
  } catch (error) {
    return { ok: false, status: 0, text: String(error && error.message ? error.message : error) };
  }
}

async function requestWithSession(tabId, url, method, csrfToken, jsonBody) {
  let injection;
  try {
    [injection] = await browser.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [url, method, csrfToken, jsonBody],
      func: async (requestUrl, requestMethod, token, body) => {
        try {
          const headers = {
            Accept: "application/json",
            "X-CSRF-Token": token
          };
          const init = {
            method: requestMethod,
            headers,
            cache: "no-store",
            credentials: "same-origin"
          };
          if (body != null) {
            headers["Content-Type"] = "application/json";
            headers["X-Requested-With"] = "XMLHttpRequest";
            init.body = JSON.stringify(body);
          }
          const response = await fetch(requestUrl, init);
          return { ok: response.ok, status: response.status, text: await response.text() };
        } catch (error) {
          return {
            ok: false,
            status: 0,
            text: String(error && error.message ? error.message : error)
          };
        }
      }
    });
  } catch (error) {
    throw new Error(humanize(error));
  }

  if (!injection || injection.result == null) {
    throw new Error("Could not run the request in the GitLab tab. Reload the page and try again.");
  }
  return injection.result;
}

async function requestJson(tabId, settings, csrfToken, path, method, jsonBody) {
  const url = settings.gitlabOrigin + path;
  const raw = settings.authMode === "token"
    ? await requestWithToken(url, method, settings.accessToken, jsonBody)
    : await requestWithSession(tabId, url, method, csrfToken, jsonBody);

  if (!raw.ok) {
    throw new Error(api.errorMessage(raw.status, raw.text, settings.authMode));
  }
  if (!raw.text) return null;
  try {
    return JSON.parse(raw.text);
  } catch {
    throw new Error("GitLab returned a response that was not JSON.");
  }
}

async function readPageContext(tabId) {
  try {
    return await browser.tabs.sendMessage(tabId, { type: "page-context" });
  } catch {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ["src/gitlab.js", "src/content.js"]
    });
    return browser.tabs.sendMessage(tabId, { type: "page-context" });
  }
}

async function addMissingReviewers(tabId, settings, context, usernames) {
  const { projectPath, iid } = context.mr;
  const mrPath = api.mergeRequestPath(projectPath, iid);
  const before = await requestJson(tabId, settings, context.csrfToken, mrPath, "GET", null);
  const current = api.reviewerUsernames(before);
  const already = api.overlap(usernames, current);
  const toAdd = api.missing(usernames, current);

  if (!toAdd.length) {
    return { added: [], already, failed: [] };
  }

  await requestJson(tabId, settings, context.csrfToken, api.notesPath(projectPath, iid), "POST", {
    body: api.assignCommand(toAdd)
  });

  const after = await requestJson(tabId, settings, context.csrfToken, mrPath, "GET", null);
  const now = api.reviewerUsernames(after);
  return {
    added: api.overlap(toAdd, now),
    already,
    failed: api.missing(toAdd, now)
  };
}

async function assign(tabId, groupId) {
  if (tabId == null) {
    return { ok: false, status: "error", message: "Open a merge request tab and try again." };
  }

  const settings = await loadSettings();
  const problem = api.settingsError(settings);
  if (problem) return { ok: false, status: "error", message: problem };

  const group = api.groupById(settings, groupId) || api.activeGroup(settings);
  if (!group || !group.usernames.length) {
    const name = group?.name ? ` to ${group.name}` : "";
    return {
      ok: false,
      status: "error",
      message: `Add at least one username${name} in the extension settings.`
    };
  }

  let context;
  try {
    context = await readPageContext(tabId);
  } catch (error) {
    return { ok: false, status: "error", message: humanize(error) };
  }

  if (!context || !context.mr) {
    return {
      ok: false,
      status: "error",
      message: "Open a merge request page first. The address should contain /-/merge_requests/ followed by a number."
    };
  }

  if (!api.sameOrigin(context.mr.origin, settings.gitlabOrigin)) {
    return {
      ok: false,
      status: "error",
      message: `This tab is ${context.mr.origin}, and the extension is set to ${settings.gitlabOrigin}.`
    };
  }

  if (settings.authMode === "session" && !context.csrfToken) {
    return {
      ok: false,
      status: "error",
      message: "This page has no GitLab CSRF token. Reload the merge request and try again."
    };
  }

  try {
    const outcome = await addMissingReviewers(tabId, settings, context, group.usernames);
    return {
      ok: outcome.failed.length === 0,
      status: api.outcomeStatus(outcome),
      message: api.summarize(outcome)
    };
  } catch (error) {
    return { ok: false, status: "error", message: error.message || "Could not add reviewers." };
  }
}

let registrationChain = Promise.resolve();

function refreshRegistration() {
  const run = registrationChain.then(() => refreshRegistrationBody().catch((error) => ({
    ok: false,
    message: humanize(error)
  })));
  registrationChain = run.then(() => undefined, () => undefined);
  return run;
}

async function refreshRegistrationBody() {
  const settings = await loadSettings();
  try {
    await browser.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  } catch {
    // The script is not registered yet.
  }

  if (!settings.gitlabOrigin) return { ok: true };

  const hasPermission = await browser.permissions.contains({
    origins: [api.hostPattern(settings.gitlabOrigin)]
  });
  if (!hasPermission) {
    return {
      ok: false,
      message: "Allow access to your GitLab site from the extension settings, then try again."
    };
  }

  await browser.scripting.registerContentScripts([
    {
      id: CONTENT_SCRIPT_ID,
      js: ["src/gitlab.js", "src/content.js"],
      matches: [api.hostPattern(settings.gitlabOrigin)],
      runAt: "document_idle",
      persistAcrossSessions: true
    }
  ]);

  const tabs = await browser.tabs.query({ url: api.hostPattern(settings.gitlabOrigin) });
  await Promise.all(tabs.map(async (tab) => {
    if (tab.id == null) return;
    try {
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["src/gitlab.js", "src/content.js"]
      });
    } catch {
      // The tab cannot take a script yet. A later page load will.
    }
  }));

  return { ok: true };
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message.type !== "string") return undefined;
  if (message.type === "assign") {
    return assign(message.tabId ?? sender.tab?.id, message.groupId);
  }
  if (message.type === "register-host") {
    return refreshRegistration();
  }
  return undefined;
});

browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    browser.runtime.openOptionsPage();
  }
  return refreshRegistration();
});

browser.runtime.onStartup.addListener(() => {
  refreshRegistration();
});

refreshRegistration();
