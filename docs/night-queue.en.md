# Running a night queue: Codex directs DeepSeek

For arbitrary planning, execution and review profiles, start with the [workflow guide](ai-workflow.en.md). The examples below retain the compatible DeepSeek/Codex defaults; new plans may select `worker:"builder"` and `reviewer:"judge"`.

The queue executes task cards in a preset, fixed order: DS edits the authorized files → the queue independently reruns the checks → Codex reads the actual artifacts and returns a structured review result. If a check fails or Codex returns `rework`, the evidence is fed back to DS; only when every check passes and Codex returns `accept` does the queue move on to the next task. Codex returning `stop`, a permission violation, an exhausted budget, or a failed review process halts the queue, and missing evidence is never treated as success.

## Preparation

- Node 24, a logged-in Codex CLI, and a working DeepSeek-compatible endpoint.
- Provide `DEEPSEEK_API_KEY`, and optionally `DEEPSEEK_BASE_URL`, through the process environment; no secrets are stored in the plan. The model ID goes in `worker.model`.
- Run in a separate Git worktree prepared for this round, keeping your original working tree and recovery point. The check commands execute project code; path checks are not an OS sandbox. Do not let the worktree contain real credentials or production data.
- Check commands must be fixed in advance by the supervisor, with argument arrays that do not go through a shell. Use absolute paths for executables; `@node` means the same Node that is running the queue. DS can only pick these checks by name and cannot construct arbitrary terminal commands.

## Plan file

Tasks may also set `role` to a repository role document name, such as `engineering`, and `contextFiles` to an explicit list of readable task inputs. With `contextFiles`, the worker may read those files, its writable files, the root AGENTS.md, and its assigned role document; directory listings are filtered to that scope. This avoids unrelated repository exploration. Small edits can use an exact, unique text replacement instead of rewriting an entire file.

```json
{
  "v": 1,
  "name": "night-work",
  "worker": { "model": "your-deepseek-model" },
  "limits": {
    "maxMinutes": 480,
    "maxAttempts": 3,
    "maxRequests": 120,
    "maxTokens": 600000,
    "maxReviews": 20,
    "attemptRequests": 12,
    "attemptTokens": 100000
  },
  "onFailure": "stop",
  "tasks": [{
    "id": "fix-parser",
    "prompt": "Fix the crash in parser.mjs caused by empty input, and keep the existing behavior.",
    "acceptance": "Empty input returns an empty result, the existing parser regression tests still pass, and the tests must not be modified to loosen the conditions.",
    "files": ["src/parser.mjs"],
    "checks": [{
      "name": "parser-tests",
      "executable": "@node",
      "args": ["--test", "tests/parser.test.mjs"],
      "timeoutMs": 60000
    }]
  }]
}
```

`files` holds explicit relative file paths. Globs, parent-directory traversal, Windows device names / ADS, secret files, and control files are not accepted. Creating new files and ordinary parent directories is allowed; directory junctions, symlink targets, and hard-link overwrites are rejected. The default read-only entry still applies; a writable single task requires `--sandbox workspace-write --policy <policy.json>`, and the policy must contain at least `v:1`, `files`, and `checks`.

There must be at least one check, and check names must be unique. Do not list the review script among the files DS may modify; automated tests are only part of the evidence, and Codex also inspects the actual artifacts independently. After a model edit and the checks, the queue verifies content snapshots of the Git-visible files; if it finds changes outside the manifest it stops, preserves the scene, and does not automatically reset or delete files. Git-ignored files are not part of the snapshot, so regenerable output produced by check tools should be written outside the worktree, and other data should be protected with a real isolation environment.

The optional `supervisor` accepts `path` (absolute path to the Codex launch entry), `model`, `effort`, and `timeoutMs`; when omitted, the current Codex configuration is used. Review runs with `read-only`, a structured output schema, and a temporary session; a non-zero exit, malformed output, or file modifications during review all fail. The review never receives DS's API key.

## Starting, watching, and stopping

In the target Git worktree:

```text
node <skill directory>/codex-task.mjs --queue night.json
node <skill directory>/codex-task.mjs --queue-status night-work
node <skill directory>/codex-task.mjs --queue night.json --resume
```

Starting prints the queue name, the monitor record name, and the state path. The queue and each DS attempt appear in the existing task list, with DS attempts nested under the queue record as parent. To stop, use the **record name** printed by this run (after a resume it may carry a numeric suffix):

```text
node <skill directory>/codex-task.mjs --stop <queue record name>
```

Queue subtasks run without independent handling; stopping the queue ends its current process tree, including the executor, the checks, and the Codex review. Do not just end the waiting command. The queue itself is a long-running CLI, so the terminal or service that started it must stay alive; this round installs no system service and does not promise to keep running after the host session closes. Users must keep the process running through a reliable service entry point they already have.

## Breakpoints and cost ceilings

`.codex-runs/<name>.queue.json` stores task state, attempt counts, usage, and the fixed plan hash. Each attempt's policy, DS usage, check results, and Codex verdict live in `<name>.queue/<task ID>/attempt-N/`. Keys never enter these files.

- `--resume` restores the original plan only; after changing tasks, acceptance, or limits you must use a new queue name. Completed tasks do not call the model again.
- The lock belongs to the worktree, not the queue name: it checks the queue, PID and process creation time, so differently named queues cannot write the same worktree concurrently. Interrupted locks require explicit recovery. Before launching a worker, the controller atomically saves its scope baseline; recovery checks that evidence before creating another attempt, so unauthorized changes from an interrupted attempt do not silently become the new baseline. Authorized unfinished edits are preserved.
- Deadlines, attempt counts, and consumption carry over from the original state and are not reset by a restart. A resume may re-execute an unfinished piece of work and does not promise exactly-once network calls.
- Before each DS start, the worst-case budget reservation is persisted first. Unused allowance is refunded only when a complete, well-formed usage record is received; if the process is interrupted, the network result is unknown, or usage is missing, the full reservation is kept, so a crash cannot bypass the limits.
- The request budget includes HTTP retries; before sending a request, DS reserves a conservative token estimate for the input and caps the output. Token accounting relies on server-reported numbers and is not a promise of a price in USD or CNY. `maxTokens` bounds DS only; Codex is bounded by `maxReviews`, the per-review timeout, and the overall queue time limit. No unified currency budget is implemented.
- `onFailure` defaults to `stop`; when set to `continue`, the queue moves on to the next task only after the current task has used up its rework attempts. Permission violations, review errors, and exhaustion of the overall budget still stop the queue.

The queue ends as soon as it has completed all tasks and does not repeat work just to fill a night. Validate the real endpoint and permissions with a small task first, then scale up the workload.
