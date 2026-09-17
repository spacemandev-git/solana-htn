# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project rules

- **Claude plans, Codex builds.** Opus 5 acts as the architect: it reads,
  designs, pins the shared contract (`packages/shared`), and splits work into
  non-overlapping slices. Each build slice is then shelled out to the Codex CLI
  running `gpt-5.6-sol` at `high` reasoning effort, run concurrently in the
  background with a strictly non-overlapping file scope. See
  "Orchestration: Opus 5 architects, Codex builds" below for the exact
  invocation and the required prompt format.
- **Keep docs up to date with all code changes.** Any change to an endpoint,
  env var, database column, program instruction, or account layout must land in
  the same change as its documentation update. See [docs/](docs/) — in
  particular `docs/API.md` for HTTP surface and `docs/PROGRAM.md` for on-chain
  layouts. A stale doc is treated as a broken build.
- **Use Anchor 2.0.0 and check against the docs in case the MCP server is out of
  date:** <https://v2.anchor-lang.com/docs/v2/get-started/>. Anchor v2 is a
  different framework from v1, not a version bump — see "Anchor v2 gotchas"
  below. The Solana MCP server's training data still mostly describes v1.

## Orchestration: Opus 5 architects, Codex builds

**Claude (Opus 5) is the architect, not the typist.** Read the repo, decide the
design, pin the shared contract, split the work into non-overlapping slices,
write exact build instructions, then verify what comes back. The file-writing
for any non-trivial build task is delegated to the **Codex CLI running GPT-5.6
Sol at `high` reasoning effort**.

| Opus 5 does it directly                          | Shell out to Codex                      |
| ------------------------------------------------ | --------------------------------------- |
| Reading code, tracing behaviour, root-causing     | Implementing a feature slice            |
| Choosing the design; writing `packages/shared`    | Writing tests against a stated spec     |
| One-line fixes, renames, doc touch-ups            | Multi-file refactors                    |
| Reviewing Codex output; running the test suite    | Mechanical migrations across many files |

Never delegate the design decision itself. If the prompt you are about to send
contains "figure out how to…", "decide whether…", or "as appropriate", stop —
you have not finished architecting. Prefer Codex over Claude subagents for
build work; reserve Claude subagents for read-only exploration.

### The invocation

Always pipe the prompt via stdin heredoc (avoids shell quoting hell) and always
pin the model and effort explicitly, even though the user config already
defaults to them:

```bash
codex exec \
  --cd /Users/spacemandev/Projects/solana-htn \
  -m gpt-5.6-sol \
  -c model_reasoning_effort="high" \
  -s workspace-write \
  -o /tmp/codex-<slice>.md \
  - <<'PROMPT'
<the prompt>
PROMPT
```

- `-s workspace-write` lets it edit the repo but **blocks network**. If the
  slice needs `bun install`, `cargo fetch`, or an RPC call, add
  `-c sandbox_workspace_write.network_access=true`.
- `-o <file>` captures the final report; read it instead of scrolling the log.
- Add `--json` only when you intend to parse events; otherwise it's noise.
- Codex loads `AGENTS.md` from the repo root — that is a symlink to this file,
  so builders inherit the Anchor v2 gotchas and conventions automatically. Do
  not delete it, and do not re-explain those rules in every prompt.

Fan out by running each slice as a **background** Bash call, one per
non-overlapping file scope. Do not run two Codex processes that can write the
same file. If slices must touch the same file, sequence them or have one Codex
own that file entirely.

### Prompt contract for GPT-5.6 Sol

Every Codex prompt uses these headings, in this order, with nothing vague left
in them. Be brutally specific: name real paths, paste real signatures, give
real commands.

```
TASK
One imperative sentence. What lands when this is done.

FILES YOU MAY CREATE OR MODIFY
- apps/server/src/routes/foo.ts        (new)
- apps/server/src/services/foo.ts      (new)
- docs/API.md                          (add the POST /api/foo section)

FILES YOU MUST NOT TOUCH
- packages/shared/**   (contract is frozen; read it, never edit it)
- apps/pwa/**          (another agent owns this slice)

READ FIRST
- packages/shared/src/schemas.ts  — the zod schemas you must reuse
- apps/server/src/routes/station.ts — copy this route's structure exactly

CONTRACT (match verbatim, do not redesign)
<paste the actual type / zod schema / function signature / SQL columns>

STEPS
1. Concrete edit.
2. Concrete edit.
3. Concrete edit.

CONSTRAINTS
- Repo-specific rules that apply to THIS slice (e.g. chain write happens after
  the DB grant; assetAddress stays null until it lands).
- Do not add dependencies. Do not reformat untouched lines.
- Do not change the public shape of anything under FILES YOU MUST NOT TOUCH.

DEFINITION OF DONE
- `bun test apps/server/test/foo.test.ts` passes.
- `bunx tsc --noEmit` is clean.
- docs/API.md documents the new endpoint.

REPORT
Print: files changed, the commands you ran with their exit status, and any
assumption you had to make. If you could not satisfy DEFINITION OF DONE, say
so explicitly instead of claiming success.
```

Rules for writing these prompts:

- **Paste the contract, don't reference it.** "Match `GrantItemResponse`" is a
  guess; the pasted type is not.
- **Enumerate the file scope both ways.** The "must not touch" list is what
  keeps parallel builders from colliding.
- **State the verification command**, not "make sure it works". If you cannot
  name a command that proves it, write the test yourself first and hand it over
  as the spec.
- **No open questions.** Codex will invent an answer and it will be wrong in a
  way that is expensive to unwind.
- One slice per invocation. If the TASK sentence needs an "and", split it.

### After Codex returns

Codex output is a proposal, not a merge. Opus 5 must:

1. `git diff` the slice and read every hunk — check scope creep first.
2. Re-run the DEFINITION OF DONE commands yourself; never trust the report.
3. Confirm the docs update landed (a stale doc is a broken build).
4. Fix small deviations inline; re-delegate with a corrected prompt if the
   slice is structurally wrong. Do not iterate by nagging — rewrite the prompt.

## Layout

```
apps/server      Bun + Hono API. SQLite via bun:sqlite. SSE for live sessions.
                 Runs the quest verification agent + x402 payer.
apps/pwa         SvelteKit 5 (runes) terminal-themed quest console + simulator.
packages/shared  Types, zod API schemas, and the pinned quest constants
                 (PDA seed, byte offsets, cluster/network/USDC ids).
packages/chain   The x402 + Solana module: 402 challenge parsing, the paying
                 fetch, raw RPC reads of hacker programs. The server consumes
                 only the frozen QuestChain interface (src/types.ts).
program          htn_quest — Anchor 2.0.0-rc.1 workspace (Rust + LiteSVM tests).
                 The reference program hackers deploy for the quest.
starter          The hacker-facing kit: x402-paywalled Hono endpoint +
                 set-message CLI. Must stay standalone-copyable (no workspace
                 imports).
scripts          Program build and local validator tooling.
```

## Commands

```bash
bun install
bun run dev                 # server + PWA together
bun test                    # all TypeScript tests
bun run program:build       # ./scripts/build-program.sh
bun run program:test        # cargo test (LiteSVM)
bun run localnet            # validator + deploy, prints env
```

## Anchor v2 gotchas

These bite hard because every v1 tutorial and most model priors are wrong here:

- Handlers take `&mut Context<T>`, not `Context<T>`.
- Account structs have **no `'info` lifetimes**: `pub payer: Signer`, not
  `Signer<'info>`.
- `Pubkey` is `Address`. `*account.address()` dereferences to it.
- `#[account]` is **zero-copy `Pod` by default**. Fields must be Pod-compatible
  (no `String`/`Vec`), and you must add explicit tail padding so the struct has
  no implicit padding holes. Use `#[account(borsh)]` + `BorshAccount<T>` for
  variable-length state.
- **Do not add `space = ...` to `init`.** v2 derives it from
  `<Account<T> as Space>::INIT_SPACE`. Static analyzers will flag its absence as
  a bug; it is not. `INIT_SPACE` includes the 8-byte discriminator.
- `has_one = x` is deprecated; use `#[account(address = other.x @ MyErr::E)]`.
  The referenced account must be declared **before** the constrained one.
- Passing the same key as two accounts where one is `mut` fails with
  `Custom(2040)` (`ConstraintDuplicateMutableAccount`). Merge them into one
  account instead of having a separate `payer` and `authority`.
- `ctx.bumps.foo` is direct field access, not `ctx.bumps.get("foo")`.
- Tests are Rust + LiteSVM, not TypeScript. LiteSVM's clock starts at zero, so
  `set_sysvar(&Clock { unix_timestamp, .. })` before asserting on timestamps.

## Building the program

`anchor build` alone is **not** deployable. It pins platform-tools v1.52, which
emits an SBPFv0 binary, and SIMD-0500 disables deployment of SBPFv0/v1/v2.
Always use `./scripts/build-program.sh`, which runs `anchor build` for the IDL
and TypeScript types, then rebuilds the `.so` with
`cargo-build-sbf --arch v3`, verifies `e_flags == 3`, and syncs the IDL into
`packages/chain/src/idl/`.

**Devnet is the exception:** it has not activated SBPFv3 (feature
`BUwGLeF3Lxyfv1J1wY8biFHBB2hrk2QhbNftQf3VV3cC`, checked 2026-09-17), so the v3
`.so` is refused there. Deploy the SBPFv0 binary `anchor build` leaves at
`program/target/sbpf-solana-solana/release/htn_quest.so` to devnet. Keep the
docs' devnet commands pointing at that path until the feature activates.

## Conventions

- TypeScript is strict with `noUncheckedIndexedAccess`. Prefer narrowing over
  non-null assertions outside of tests.
- Svelte 5 runes (`$state`, `$derived`, `$effect`) only — no stores, no Svelte 4
  syntax.
- The quest contract is pinned in `packages/shared/src/quest.ts` (PDA seed,
  `QUEST_MESSAGE_OFFSET = 40`, message cap, USDC mints, x402 network ids) and
  in the frozen `QuestChain` interface (`packages/chain/src/types.ts`). Never
  re-declare those values elsewhere; `starter/` is the one allowed copy (it
  must stay standalone) and marks its copies with a source comment.
- **Pay-once is a database fact**: `quest_submissions.paid` is written in the
  same step that records the settlement signature, *before* proof evaluation.
  The $1 cap (`MAX_REWARD_USD`) is enforced independently at challenge
  validation and again inside `packages/chain` right before paying. Never relax
  any of the three without changing all of them knowingly.
- All money-moving and chain-reading code lives in `packages/chain`; no
  `@x402/*` or `@solana/*` imports in `apps/server` or `apps/pwa`.
- Verification steps run cheap-and-read-only first; money moves at step 4 of 5.
  Keep that ordering.
- Discriminators are read from the generated IDL (`starter/idl/`), never
  hardcoded. If you change an instruction name, rebuild so it is refreshed.
- The server must run end-to-end with the disabled chain client (no payer key):
  simulated payments + the dev mock vendor keep `/sim` demoable offline.
