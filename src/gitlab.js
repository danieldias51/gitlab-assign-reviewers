"use strict";

const GitLabReviewers = (() => {
  const STORAGE_KEYS = ["gitlabOrigin", "usernames", "groups", "activeGroupId", "authMode", "accessToken"];

  function normalizeOrigin(input) {
    const raw = String(input || "").trim();
    if (!raw) {
      return { error: "Enter your GitLab site, for example https://gitlab.example.com." };
    }

    let url;
    try {
      url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    } catch {
      return { error: "That GitLab site is not a valid URL." };
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { error: "The GitLab site must start with https:// or http://." };
    }
    if (url.username || url.password) {
      return { error: "Remove the username and password from the site URL." };
    }
    if (url.pathname !== "/" && url.pathname !== "") {
      return { error: "Use the site root only, for example https://gitlab.example.com." };
    }
    if (url.search || url.hash) {
      return { error: "Use the site root only, for example https://gitlab.example.com." };
    }

    return { value: url.origin };
  }

  function parseUsernames(input) {
    const seen = new Set();
    const usernames = [];
    for (const part of String(input || "").split(/[\s,;]+/)) {
      const username = part.trim().replace(/^@+/, "");
      if (!username) continue;
      const key = username.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      usernames.push(username);
    }
    return usernames;
  }

  function cleanGroupName(name) {
    return String(name || "").replace(/\s+/g, " ").trim().slice(0, 40);
  }

  function newGroupId() {
    if (globalThis.crypto?.randomUUID) return `group-${crypto.randomUUID()}`;
    return `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function storedUsernames(value) {
    if (!Array.isArray(value)) return [];
    return parseUsernames(value.filter((name) => typeof name === "string" && name).join(","));
  }

  function normalizeGroups(value) {
    if (!Array.isArray(value)) return [];
    const seenIds = new Set();
    const groups = [];
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      groups.push({
        id,
        name: cleanGroupName(entry.name),
        usernames: storedUsernames(entry.usernames)
      });
    }
    return groups;
  }

  function blankGroup() {
    return { id: "group-default", name: "Team", usernames: [] };
  }

  function parseSettingsInput({ gitlabOrigin, groups, activeGroupId, authMode, accessToken }) {
    const origin = normalizeOrigin(gitlabOrigin);
    if (origin.error) return { error: origin.error };

    const normalized = normalizeGroups(groups);
    if (!normalized.length) return { error: "Add a group." };

    const seenNames = new Set();
    for (const group of normalized) {
      if (!group.name) return { error: "Give every group a name." };
      const key = group.name.toLowerCase();
      if (seenNames.has(key)) return { error: `There are two groups named ${group.name}.` };
      seenNames.add(key);
      if (!group.usernames.length) {
        return { error: `Add at least one username to ${group.name}.` };
      }
    }

    const mode = authMode === "token" ? "token" : "session";
    const token = String(accessToken || "").replace(/\s+/g, "");
    if (mode === "token" && !token) {
      return { error: "Add a personal access token, or choose browser session." };
    }

    const active = normalized.some((group) => group.id === activeGroupId)
      ? activeGroupId
      : normalized[0].id;

    return {
      value: {
        gitlabOrigin: origin.value,
        groups: normalized,
        activeGroupId: active,
        authMode: mode,
        accessToken: token
      }
    };
  }

  function settingsFromStorage(stored) {
    const source = stored || {};
    let groups = normalizeGroups(source.groups).map((group) => ({
      ...group,
      name: group.name || "Team"
    }));
    if (!groups.length) {
      const legacy = storedUsernames(source.usernames);
      groups = [{ ...blankGroup(), usernames: legacy }];
    }

    const activeGroupId = groups.some((group) => group.id === source.activeGroupId)
      ? source.activeGroupId
      : groups[0].id;

    return {
      gitlabOrigin: typeof source.gitlabOrigin === "string" ? source.gitlabOrigin : "",
      groups,
      activeGroupId,
      authMode: source.authMode === "token" ? "token" : "session",
      accessToken: typeof source.accessToken === "string" ? source.accessToken : ""
    };
  }

  function activeGroup(settings) {
    const groups = settings?.groups || [];
    if (!groups.length) return null;
    return groups.find((group) => group.id === settings.activeGroupId) || groups[0];
  }

  function groupById(settings, groupId) {
    if (!groupId) return null;
    return (settings?.groups || []).find((group) => group.id === groupId) || null;
  }

  function settingsError(settings) {
    if (!settings.gitlabOrigin) {
      return "Set your GitLab site in the extension settings.";
    }
    if (!settings.groups.length) {
      return "Add a group in the extension settings.";
    }
    if (settings.authMode === "token" && !settings.accessToken) {
      return "Add a personal access token, or switch to browser session.";
    }
    return "";
  }

  function parseMergeRequestUrl(urlString) {
    let url;
    try {
      url = new URL(urlString);
    } catch {
      return null;
    }

    const match = url.pathname.match(/^(.*)\/-\/merge_requests\/(\d+)(?:\/|$)/);
    if (!match) return null;

    const projectPath = match[1].replace(/^\/+/, "");
    if (!projectPath || projectPath.includes("/-")) return null;

    return {
      origin: url.origin,
      projectPath,
      iid: match[2]
    };
  }

  function sameOrigin(left, right) {
    return String(left || "").toLowerCase() === String(right || "").toLowerCase();
  }

  function namesKey(names) {
    return new Set((names || []).map((name) => String(name).toLowerCase()));
  }

  function overlap(left, right) {
    const rightKeys = namesKey(right);
    return (left || []).filter((name) => rightKeys.has(name.toLowerCase()));
  }

  function missing(left, right) {
    const rightKeys = namesKey(right);
    return (left || []).filter((name) => !rightKeys.has(name.toLowerCase()));
  }

  function reviewerUsernames(mergeRequest) {
    const reviewers = Array.isArray(mergeRequest?.reviewers) ? mergeRequest.reviewers : [];
    return reviewers
      .map((reviewer) => reviewer && reviewer.username)
      .filter((username) => typeof username === "string" && username);
  }

  function assignCommand(usernames) {
    return `/assign_reviewer ${usernames.map((username) => `@${username}`).join(" ")}`;
  }

  function mergeRequestPath(projectPath, iid) {
    return `/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests/${iid}`;
  }

  function notesPath(projectPath, iid) {
    return `${mergeRequestPath(projectPath, iid)}/notes`;
  }

  function hostPattern(origin) {
    return `${origin}/*`;
  }

  function handles(usernames) {
    return usernames.map((username) => `@${username}`).join(", ");
  }

  function summarize({ added, already, failed }) {
    if (!added.length && !failed.length) {
      return "Everyone on your list is already a reviewer.";
    }

    const parts = [];
    if (added.length) parts.push(`Added ${handles(added)}.`);
    if (already.length && (added.length || failed.length)) {
      parts.push(`Already reviewing: ${handles(already)}.`);
    }
    if (failed.length) {
      parts.push(
        `Could not add ${handles(failed)}. Check the username and that they can see this project.`
      );
    }
    return parts.join(" ");
  }

  function outcomeStatus({ added, failed }) {
    if (failed.length) return added.length ? "warning" : "error";
    return "success";
  }

  function extractDetail(text) {
    if (!text) return "";
    try {
      const data = JSON.parse(text);
      const message = data.message ?? data.error ?? data;
      if (typeof message === "string") return message.slice(0, 300);
      return JSON.stringify(message).slice(0, 300);
    } catch {
      return String(text).replace(/\s+/g, " ").trim().slice(0, 300);
    }
  }

  function errorMessage(status, text, authMode) {
    if (status === 401) {
      return authMode === "token"
        ? "GitLab rejected the access token. Check that it is active and includes the api scope."
        : "GitLab rejected the browser session. Reload the page and confirm you are signed in.";
    }
    if (status === 403) {
      return "GitLab refused this request. Your account needs permission to add reviewers on this project.";
    }
    if (status === 404) {
      return "GitLab could not find this merge request for the site saved in settings.";
    }
    const detail = extractDetail(text);
    if (status === 0) {
      return detail
        ? `The browser could not reach GitLab. ${detail}`
        : "The browser could not reach GitLab.";
    }
    if (detail) return `GitLab returned ${status}: ${detail}`;
    return `GitLab returned status ${status}.`;
  }

  function mergeRequestLabel(mergeRequest) {
    if (!mergeRequest) return "";
    return `${mergeRequest.projectPath} !${mergeRequest.iid}`;
  }

  return {
    STORAGE_KEYS,
    normalizeOrigin,
    parseUsernames,
    cleanGroupName,
    newGroupId,
    parseSettingsInput,
    settingsFromStorage,
    activeGroup,
    groupById,
    settingsError,
    parseMergeRequestUrl,
    sameOrigin,
    overlap,
    missing,
    reviewerUsernames,
    assignCommand,
    mergeRequestPath,
    notesPath,
    hostPattern,
    summarize,
    outcomeStatus,
    errorMessage,
    mergeRequestLabel
  };
})();

globalThis.GitLabReviewers = GitLabReviewers;

if (typeof module !== "undefined" && module.exports) {
  module.exports = { GitLabReviewers };
}
