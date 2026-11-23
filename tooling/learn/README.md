# @crossbind/learn

The tutorial and the playground, as crossbind.dev (`landing/`) and the crossbind app both use them: the samples and
the lessons, a project and its drafts, the runner that runs `main.js` in a sandboxed frame, the editor and the console.
Private, never published.

| Files | What they hold |
| --- | --- |
| `src/sampleList.js`, `src/samples/`, `src/samples.js` | The samples in picker order, their files, each as a project |
| `src/tutorial.js`, `src/sections.js` | The lessons in reading order, one per sample, and their contents by part |
| `src/project.js`, `src/drafts.js` | A project as the playground compiler takes it, and the edits kept per sample |
| `src/useRunner.js`, `src/prebuilt.js`, `src/compiled.js`, `src/runReason.js` | The runner, a sample's prebuilt module, a compile's answer, and why Run is off |
| `src/sandbox.js`, `src/modules.js`, `src/sandbox.html` | The sandboxed frame, the modules it makes and its page |
| `src/Editor.jsx`, `src/highlight.jsx`, `src/output.jsx`, `src/inline.jsx` | The editor and its colours, the console, and the lessons' inline markup |

What the caller gives, so that neither the site nor the app imports the other's:

- `useRunner({ compile, canCompile, prebuilt })`. `prebuilt(sampleId)` says where a sample's module built ahead of time
  is (`{ script, wasm, imports }`, or nothing); `compile(request)` sends a project as a compile takes it and resolves
  to the playground compiler's answer; `canCompile` says whether it can now. The site's are its demos
  (`landing/src/demos.js`) and its session (`landing/src/playground/useSession.js`).
- `tutorialSteps({ lesson, guide, libraries, playground, createCommand })`: where a lesson's links lead, and the command
  that starts a project.
- `src/sandbox.html` at `/playground/sandbox.html` (`SANDBOX_URL`), under a policy that names its script's hash: the
  site serves it from here (`landing/vite.config.js`, `landing/public/_headers`).
- React's names, which the components import and the caller's Vite resolves to its Preact (`resolve.dedupe`).

```bash
pnpm --filter @crossbind/learn test
```
