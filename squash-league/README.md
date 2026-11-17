# Squash League HQ

Results site for James v Mic (the main event) and the Jigs-Lah Trophy (the lower leagues).

It's a plain static site with no build step, so it runs on GitHub Pages for free. Results come from a Google Sheet that only James can edit. Everyone else adds results through a Google Form, so nobody can break the records.

```
Friends ──► Google Form ──► Google Sheet ("Responses" tab) ──► website reads it live
                                  ▲
James fixes mistakes here ────────┘
```

If the Sheet ever can't be reached, the site falls back to `data/snapshot.js`, a copy of all results up to 15 Nov 2026.

---

## One-time setup (about 10 minutes)

### 1. Create the Sheet and the Form (about 3 minutes)

1. Go to https://script.google.com and click **New project**.
2. Delete the placeholder code, paste in everything from `scripts/google-setup.gs`, and save.
3. Pick `setup` in the function dropdown at the top and press **▶ Run**.
4. Google asks for permissions. Click through them, including **Advanced → Go to project (unsafe)**. It's your own script, but Google warns about every unverified script.
5. The **Execution log** prints a `SHEET_ID` and a `FORM_URL`. Paste both into `config.js`.

The script creates:
- **Squash League HQ: Results**, a Sheet with a **History** tab (every past result) and a **Responses** tab (new results from the form).
- **Report a Squash Result**, a form with dropdowns for the scores. Players choose the rivalry, and the form only shows the questions for that one.
- View-only link sharing on the Sheet, which the website needs to read it. If your Google Workspace account blocks link sharing, the log tells you. In that case run the script from a personal Gmail account instead.

### 2. Put it on GitHub Pages

1. On github.com, create a new **public** repository, e.g. `squash-league`. (Pages is only free on public repos.)
2. Upload everything in this folder. Either drag the files onto the repo's "uploading an existing file" page, or use git:
   ```bash
   cd squash-league
   git remote add origin https://github.com/YOUR-USERNAME/squash-league.git
   git push -u origin main
   ```
3. In the repo, go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, select **main** and **/ (root)**, then click **Save**.
4. About a minute later the site is live at `https://YOUR-USERNAME.github.io/squash-league/`.

Send the site link to Mic, Jack and Kevin. The **Report a result** button opens the form.

---

## Day to day

- **Adding a result:** use the form. The site shows it within a minute or two (Google caches the Sheet briefly).
- **Fixing a mistake:** open the Sheet and edit or delete the row in **Responses**. Old results live in **History**, and you can edit those too.
- **One form entry = one match** for Jigs v Lah (best of five; a match only counts as won at 3 games, otherwise it's "unfinished"), and **one session** for James v Mic (total games each).
- The site quietly ignores impossible entries, such as 3–3 or 0–0.

## Things you might want to change

| What | Where |
|---|---|
| Player taglines, headlines, captions | `index.html` |
| Funny auto-generated lines (e.g. "asked for the lighting to be reviewed") | `app.js`, search for `deck` |
| Photos | `img/`. Replace the James/Mic "Photo pending" silhouettes by swapping the `.mugshot` divs for `<img>` tags |
| Colours and fonts | top of `styles.css` |

## Credits

Fonts: Bowlby One, Atkinson Hyperlegible and DSEG (7- and 14-segment), all under the SIL Open Font License and self-hosted in `fonts/`.
