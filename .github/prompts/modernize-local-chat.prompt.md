---
name: "Modernize Local Chat App"
description: "Use when refactoring a small local chatbot or PWA into a production-ready React app with Material Design, tests, docs, and deploy-ready structure"
argument-hint: "Describe the app or refactor goal"
agent: "agent"
---
Modernize the current frontend app according to this pattern:

- Keep the product intentionally simple and testable.
- Use React and a current Material Design implementation from Google.
- Make the UI responsive for mobile and desktop.
- Keep business logic in small testable modules.
- Add or update local tests for UI, environment checks, and app logic.
- Leave the project ready for local development, production build, and GitHub Pages deployment.
- Add or refresh project documentation in `instructions.md` when architecture or workflows change.

When you perform this task:

- First inspect the existing project shape and deployment workflow.
- Prefer minimal architecture with clear file boundaries.
- Explain any browser or platform constraints that affect runtime behavior.
- If the app uses browser-only AI features such as WebGPU, validate secure-context requirements.
- Update CI or deployment workflows if the build system changes.

Expected output:

- Implemented code changes in the workspace.
- A concise summary of architecture changes.
- Exact local commands to run dev server, tests, and production preview.
- Any production caveats that still require user action.