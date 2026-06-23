# Claude Code Configuration - RuFlo V3

## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (*.md) or README files unless explicitly requested
- NEVER save working files, text/mds, or tests to the root folder
- Never continuously check status after spawning a swarm — wait for results
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files

## Branch Management (Always Enforced)

- ALWAYS create a new branch at the start of every major session (new phase, new feature wave, new bug-fix sprint)
- Branch naming convention: `phase/<phase-name>` for feature phases, `fix/<description>` for bug-fix phases, `wave/<wave-name>` for architecture waves
- NEVER commit directly to `main` — all changes go through a branch first
- When a phase is complete and verified, open a PR to `main` and wait for review/approval before merging
- After merging to `main`, delete the working branch
- Example branch creation at session start:
  ```bash
  git checkout main
  git pull origin main
  git checkout -b phase/bug-fix-security
  ```

## Code Quality Standards (Always Enforced)

- Write code like a senior developer — clean, readable, purposeful
- Every function/method MUST have a JSDoc comment explaining WHAT it does and WHY, not just what the code literally says:
  ```ts
  /**
   * Increments the usage counter atomically for a given user and metric.
   * Uses a DB-level upsert to avoid race conditions under concurrent requests.
   * Call this after every successful AI generation, publish, or billable action.
   */
  export async function incrementUsage(...): Promise<void>
  ```
- Comments on non-obvious logic blocks — explain the WHY, not the WHAT
- No `any` types in new code — use proper TypeScript types or `unknown` with narrowing
- No dead code — remove unused imports, variables, and functions
- No silent error swallowing — every `catch` must either log the error or rethrow it
- Keep files under 500 lines — split large files into focused modules
- Group related logic into descriptive sections with a `// --- Section Name ---` divider

## Phase Discipline (Always Enforced)

- All multi-step work is organized into PHASES (not sprints, not tasks — PHASES)
- At the start of every phase: read the phase plan, confirm scope, create the branch
- At the end of every phase: run the phase's test suite AND manually cross-check every item in the phase plan before marking it complete
- NEVER move to the next phase until the current phase passes ALL of the following:
  1. `npm run build` exits 0
  2. `npx tsc --noEmit` exits 0
  3. `npm run lint` exits 0
  4. Phase test suite passes (all tests green)
  5. Every item in the phase plan is checked off manually
- If any item fails the cross-check, fix it in the current phase — do NOT carry it forward
- Phase completion is confirmed by a summary message listing each plan item and its status

## Testing Rules (Always Enforced)

- Every phase MUST have a test file in `/tests` named `phase-<name>.test.ts`
- Test coverage requirements per phase:
  - Every new/modified function has at least one unit test
  - Every API route change has an integration test (authenticated + unauthenticated cases)
  - Every bug fix has a regression test that would have caught the original bug
  - Every security fix has a test that verifies the vulnerability is closed
- Test file structure:
  ```ts
  // tests/phase-bug-fix-security.test.ts
  describe('Phase: Bug Fix Security', () => {
    describe('S0-1: CSRF logout fix', () => {
      it('should NOT clear token on GET /login?expired=1', async () => { ... });
      it('should still redirect authenticated users to /dashboard', async () => { ... });
    });
    // ... one describe block per phase item
  });
  ```
- Run tests with `npm test` — all must pass before phase is considered complete
- Write tests BEFORE or ALONGSIDE the fix — not as an afterthought after the phase

## File Organization

- NEVER save to root folder — use the directories below
- Use `/src` for source code files
- Use `/tests` for test files
- Use `/docs` for documentation and markdown files
- Use `/config` for configuration files
- Use `/scripts` for utility scripts
- Use `/examples` for example code

## Project Architecture

- Follow Domain-Driven Design with bounded contexts
- Keep files under 500 lines
- Use typed interfaces for all public APIs
- Prefer TDD London School (mock-first) for new code
- Use event sourcing for state changes
- Ensure input validation at system boundaries

### Project Config

- **Topology**: hierarchical-mesh
- **Max Agents**: 15
- **Memory**: hybrid
- **HNSW**: Enabled
- **Neural**: Enabled

## Build & Test

```bash
# Build
npm run build

# Test
npm test

# Lint
npm run lint
```

- ALWAYS run tests after making code changes
- ALWAYS verify build succeeds before committing

## Security Rules

- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER commit .env files or any file containing secrets
- Always validate user input at system boundaries
- Always sanitize file paths to prevent directory traversal
- Run `npx @claude-flow/cli@latest security scan` after security-related changes

## Concurrency: 1 MESSAGE = ALL RELATED OPERATIONS

- All operations MUST be concurrent/parallel in a single message
- Use Claude Code's Task tool for spawning agents, not just MCP
- ALWAYS batch ALL todos in ONE TodoWrite call (5-10+ minimum)
- ALWAYS spawn ALL agents in ONE message with full instructions via Task tool
- ALWAYS batch ALL file reads/writes/edits in ONE message
- ALWAYS batch ALL Bash commands in ONE message

## Swarm Orchestration

- MUST initialize the swarm using CLI tools when starting complex tasks
- MUST spawn concurrent agents using Claude Code's Task tool
- Never use CLI tools alone for execution — Task tool agents do the actual work
- MUST call CLI tools AND Task tool in ONE message for complex work

### 3-Tier Model Routing (ADR-026)

| Tier | Handler | Latency | Cost | Use Cases |
|------|---------|---------|------|-----------|
| **1** | Agent Booster (WASM) | <1ms | $0 | Simple transforms (var→const, add types) — Skip LLM |
| **2** | Haiku | ~500ms | $0.0002 | Simple tasks, low complexity (<30%) |
| **3** | Sonnet/Opus | 2-5s | $0.003-0.015 | Complex reasoning, architecture, security (>30%) |

- Always check for `[AGENT_BOOSTER_AVAILABLE]` or `[TASK_MODEL_RECOMMENDATION]` before spawning agents
- Use Edit tool directly when `[AGENT_BOOSTER_AVAILABLE]`

## Swarm Configuration & Anti-Drift

- ALWAYS use hierarchical topology for coding swarms
- Keep maxAgents at 6-8 for tight coordination
- Use specialized strategy for clear role boundaries
- Use `raft` consensus for hive-mind (leader maintains authoritative state)
- Run frequent checkpoints via `post-task` hooks
- Keep shared memory namespace for all agents

```bash
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized
```

## Swarm Execution Rules

- ALWAYS use `run_in_background: true` for all agent Task calls
- ALWAYS put ALL agent Task calls in ONE message for parallel execution
- After spawning, STOP — do NOT add more tool calls or check status
- Never poll TaskOutput or check swarm status — trust agents to return
- When agent results arrive, review ALL results before proceeding

## V3 CLI Commands

### Core Commands

| Command | Subcommands | Description |
|---------|-------------|-------------|
| `init` | 4 | Project initialization |
| `agent` | 8 | Agent lifecycle management |
| `swarm` | 6 | Multi-agent swarm coordination |
| `memory` | 11 | AgentDB memory with HNSW search |
| `task` | 6 | Task creation and lifecycle |
| `session` | 7 | Session state management |
| `hooks` | 17 | Self-learning hooks + 12 workers |
| `hive-mind` | 6 | Byzantine fault-tolerant consensus |

### Quick CLI Examples

```bash
npx @claude-flow/cli@latest init --wizard
npx @claude-flow/cli@latest agent spawn -t coder --name my-coder
npx @claude-flow/cli@latest swarm init --v3-mode
npx @claude-flow/cli@latest memory search --query "authentication patterns"
npx @claude-flow/cli@latest doctor --fix
```

## Available Agents (60+ Types)

### Core Development
`coder`, `reviewer`, `tester`, `planner`, `researcher`

### Specialized
`security-architect`, `security-auditor`, `memory-specialist`, `performance-engineer`

### Swarm Coordination
`hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`

### GitHub & Repository
`pr-manager`, `code-review-swarm`, `issue-tracker`, `release-manager`

### SPARC Methodology
`sparc-coord`, `sparc-coder`, `specification`, `pseudocode`, `architecture`

## Memory Commands Reference

```bash
# Store (REQUIRED: --key, --value; OPTIONAL: --namespace, --ttl, --tags)
npx @claude-flow/cli@latest memory store --key "pattern-auth" --value "JWT with refresh" --namespace patterns

# Search (REQUIRED: --query; OPTIONAL: --namespace, --limit, --threshold)
npx @claude-flow/cli@latest memory search --query "authentication patterns"

# List (OPTIONAL: --namespace, --limit)
npx @claude-flow/cli@latest memory list --namespace patterns --limit 10

# Retrieve (REQUIRED: --key; OPTIONAL: --namespace)
npx @claude-flow/cli@latest memory retrieve --key "pattern-auth" --namespace patterns
```

## Quick Setup

```bash
claude mcp add claude-flow -- npx -y @claude-flow/cli@latest
npx @claude-flow/cli@latest daemon start
npx @claude-flow/cli@latest doctor --fix
```

## Claude Code vs CLI Tools

- Claude Code's Task tool handles ALL execution: agents, file ops, code generation, git
- CLI tools handle coordination via Bash: swarm init, memory, hooks, routing
- NEVER use CLI tools as a substitute for Task tool agents

## Support

- Documentation: https://github.com/ruvnet/claude-flow
- Issues: https://github.com/ruvnet/claude-flow/issues
