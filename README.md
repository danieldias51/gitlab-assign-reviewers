# GitLab Assign Reviewers

Firefox extension that adds a saved group of teammates as reviewers on the merge request you have open.

The click adds only people who are not already reviewers. Everyone else on the merge request stays as they are, and someone already on your list is not asked for a fresh review.

## Test instructions

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Choose `manifest.json` in this folder.

Firefox drops a temporary add-on when the browser closes. For an install that survives restarts, submit it to addons.mozilla.org as an unlisted add-on, or install it in Firefox Developer Edition with `xpinstall.signatures.required` set to `false`.

The settings page opens after the first install. Saving asks Firefox for permission to talk to that GitLab site.

## Settings

- **GitLab site:** the site root, such as `https://gitlab.example.com`.
- **Reviewer groups:** named lists such as Backend and Frontend. Mark one as the group the popup opens on. Usernames are comma, space, or newline separated, and a leading `@` is optional. A list saved by an older version of the extension becomes a group named Team.
- **Browser session:** uses the GitLab login already open in Firefox. The request runs inside the merge request tab, with that page's CSRF token. The access token is never sent in this mode.
- **Personal access token:** a GitLab token with the `api` scope (Preferences → Access tokens). The token stays in the extension's local storage in this browser and is sent only from the extension background, not from the GitLab page.

## Use it

Open a merge request. The toolbar popup opens on your default group and lists its usernames. Choose another group in the menu to apply that list instead. The card at the bottom left of the page adds the same group the popup is set to.

GitLab receives `/assign_reviewer` for the missing usernames. The extension then reads the merge request again and reports who was added, who was already a reviewer, and who GitLab did not add.

## Tests

```bash
npm test
```

## Privacy

The extension sends data only to the GitLab site you configure. See [PRIVACY.md](PRIVACY.md).

## License

MIT. See [LICENSE](LICENSE).
