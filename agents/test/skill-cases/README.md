# Skill cases

The prompts the crossbind skill is measured with. A case is a prompt, the project it is asked in, whether the skill should load for it, and what a right answer says. `pnpm check:agents` checks the table itself, with no model, in `agents/test/skill-cases.test.mjs`.

## A case

| Field | What it holds |
|---|---|
| `id` | `p###` for a prompt of the numbered list, `a###` for one added beside it |
| `prompt` | What the agent is asked, word for word |
| `tags` | The first is the case's group, which the split and the reports go by |
| `fixture` | The project the prompt is asked in, by its name in `fixtures.mjs` |
| `trigger` | Whether the skill should load: `must`, `must-not`, or `either` where both are right |
| `expect` | `do` where a right answer does what is asked, `object` where it says why that cannot be done as asked |
| `route` | The references of the skill that hold the answer. A diagnostic: an answer may be right by another way |
| `facts` | What a right answer says, each as a `claim`, the `doc` it rests on and a `literal` that document has |
| `split` | `train` for the cases the skill is improved against, `test` for those the score is reported from |

## When the skill should load

- `must`: the request needs native code or a named native library from JavaScript; it asks to build, publish or update a web project as a desktop or mobile app; or it names crossbind.
- `must-not`: web, backend or other-language work with none of those, and work in a crossbind project that has nothing to do with crossbind.
- `either`: a request that a plain web answer and a crossbind one both serve, as an app with no platform named.

## Claims

A claim is one statement about the answer that can be checked by reading it. It rests on a document an installed skill carries: one the references are generated from, `SKILL.md` or the port catalog. Its `literal` is a piece of that document: when the document no longer has it, the test fails, and the claim is read again against the new text.

## Adding a case

1. Add it to a file under `cases/`, without a `split`.
2. Run `node agents/test/skill-cases/assign-split.mjs`, which gives each new case a split and moves none that has one.
3. Run `pnpm test:agents`.

A case that names another product stays out of the repository: `loadCases()` and the split script take further files.
