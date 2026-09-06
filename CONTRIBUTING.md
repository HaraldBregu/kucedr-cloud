# Contributing to kucedr-cloud

Thank you for helping improve kucedr-cloud. Keep each contribution focused on one problem and make the
smallest change that solves it.

## Prerequisites

- Node.js 26.7 or later
- npm 12.0.2 or later

## Set up the project

```bash
git clone https://github.com/HaraldBregu/kucedr-cloud.git
cd kucedr-cloud
npm ci
cp .env.example .env
npm run dev
```

Set the A2A public URL to `http://127.0.0.1:3000` and add development A2A/provider credentials to
`.env`. The development server exposes the same A2A-only interface as the container. Automated tests
do not require live provider credentials.

## Project layout

- `src/main/agent` contains the agent runtime, tools, sessions, and model adapters.
- `src/main/a2a` contains the A2A interface and task handling.
- `src/main/access`, `admin`, `provider`, and `storage` contain the server-side APIs.
- `src/main/shared` contains shared utilities and types.
- `src/ui` contains the browser interface.
- `tests` contains the Node test suites.
- `public` contains public assets such as the kucedr-cloud logo.

## Make a change

1. Start from an up-to-date branch based on `main`.
2. Keep the change limited to the behavior being addressed.
3. Add or update a test when behavior changes or a bug is fixed.
4. Run the relevant test while developing. For example:

   ```bash
   node --import tsx --test tests/server.test.ts
   ```

5. Format source and test files before running the full verification suite:

   ```bash
   npm run format
   ```

Follow the repository conventions in [AGENTS.md](../AGENTS.md): prefer simple, direct implementations;
keep responsibilities in separate modules; use one function per file; and avoid unrelated cleanup,
speculative abstractions, or unrequested comments. Match the existing TypeScript and UI style in the
area you change.

## Verify the change

Run all checks before opening a pull request:

```bash
npm test
npm run typecheck
npm run build
npm run format:check
```

Use `npm run test:watch` for feedback during development or `npm run test:coverage` when you need a
coverage report.

## Open a pull request

- Use a clear title and explain the user-visible problem and solution.
- List the verification commands you ran and their results.
- Include screenshots for changes to the browser interface.
- Keep unrelated changes out of the pull request.
- Never commit API keys, access tokens, credentials, or environment files.

Report vulnerabilities according to [SECURITY.md](SECURITY.md) instead of opening a public issue.
