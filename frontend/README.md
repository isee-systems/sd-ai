# SD-AI Frontend

A static documentation site for the SD-AI project, running at
[https://ub-iad.github.io/sd-ai/](https://ub-iad.github.io/sd-ai/).

## What this is

- A **frontend-only** React single page application living in the `frontend/`
  folder, with its own dependencies and `package.json` separate from the rest
  of the `sd-ai` project.
- It is a **pure static documentation site**: it has **no backend and no
  engine-testing capability**. It does not call the `sd-ai` API at runtime.
- Instead, a build step introspects the repository and generates the data the
  site renders. The site documents:
  - **Engines** — every engine in `engines/`, with a toggle to reveal `test-`
    engines. Each engine page shows its description, supported modes, reference
    link, source, and full parameter schema.
  - **Agents** — the conversational modeling assistants whose configs are
    checked into `agent/config/` (Socrates, Merlin, Athena today; the two
    Athena phase files are merged into one entry). Each shows its metadata and
    full system prompt.
  - **Evaluations** — every eval category in `evals/categories/`, down to each
    individual test's prompt and expectations.
  - **Leaderboards** — per-mode benchmark results, pre-aggregated at build time
    from `evals/results/`.

## How the data is generated

`scripts/generateData.mjs` runs before every `dev`/`build`. It imports the
engine/eval/agent modules directly from the repo root and calls the same
methods the backend routes use (`supportedModes()`, `description()`, `link()`,
`additionalParameters()`, `AgentConfigurationManager.parseContent()`, …),
writing JSON into `src/generated/` (which is git-ignored and regenerated on
every build). The React pages import that JSON statically — there is no
runtime API client.

Because the generator imports modules from the repo root, the **root**
dependencies must be installed (`npm ci` at the repo root) in addition to the
frontend dependencies.

Agents are discovered from **git-tracked** files in `agent/config/` only, so
untracked/experimental configs never appear in the docs.

## Development

```bash
# from the repo root, once, so the generator can import engine/agent/eval modules
npm ci

# then, in this folder
cd frontend
npm install
npm run dev        # runs the generator, then vite dev
```

The app will be available at `http://localhost:5173/sd-ai/`.

Useful scripts:
- `npm run generate` — regenerate `src/generated/*.json` only.
- `npm run build` — regenerate data, then produce a production build in `dist/`.
- `npm run preview` — serve the production build locally.
- `npm run lint` — run ESLint.

## Deployment

The site deploys automatically to **GitHub Pages** via GitHub Actions
(`.github/workflows/deploy-pages.yml`) on every push to `main`. The workflow
installs root + frontend dependencies, runs `npm run build`, and publishes
`frontend/dist`.

**One-time repo setup:** in the repository's **Settings → Pages**, set
**Source** to **"GitHub Actions"**. No manual `gh-pages` step is needed.

The site is served as a project page under `/sd-ai/`; the Vite `base` is set to
`/sd-ai/` and routing uses `HashRouter`, so it works on GitHub Pages without any
server-side rewrite configuration.
