# D.A.E.M.O.N. Feature Upgrade Plan

## Context

The user saw a friend's productivity dashboard and wants to incorporate 5 major features into D.A.E.M.O.N.: (1) sidebar layout with better readability, (2) AI actions embedded in every panel, (3) drag-and-drop agent personas with orchestrated handoffs, (4) lava lamp animated background, and (5) automated to-dos aggregated from Slack/GitLab/Linear. The current app is a 2x2 CSS grid of panels with small (9-11px) UI text and a separate Agents panel. This plan restructures the entire UX.

---

## Build Order

Features have dependencies — build in this order:

```
Phase 1: Sidebar Layout ............. foundation for everything else
Phase 2: Lava Lamp Background ....... independent, fills visual gap
Phase 3: AI Built Into Everything ... needs sidebar layout + terminal
Phase 4: Agent Personas ............. needs Phase 3 infrastructure
Phase 5: Automated To-Dos ........... aggregates from all sources
```

---

## Phase 1: Sidebar Layout + Readability

**Why first:** Every other feature needs the sidebar nav and main content area to exist.

### Architecture

Replace the 2x2 `DashboardGrid` with a sidebar + main content layout:

```
┌──────────────────────────────────────────────────┐
│  TitleBar (logo, title, window controls)          │
├────────────┬─────────────────────────────────────┤
│  Sidebar   │  Main Content                        │
│  280px     │  (active panel, full-width)           │
│            │                                       │
│  [Slack]   │  ┌─────────────────────────────────┐ │
│  [GitLab]  │  │  Panel content renders here     │ │
│  [Linear]  │  │  with bigger text + more space  │ │
│  [Agents]  │  │                                 │ │
│            │  └─────────────────────────────────┘ │
│  (summary  │                                       │
│   badges)  │                                       │
├────────────┴─────────────────────────────────────┤
│  StatusBar                                        │
└──────────────────────────────────────────────────┘
```

Each sidebar nav item shows: icon + label + count badge (unread Slack, MRs needing you, etc.). Clicking switches the main content area. Sidebar is collapsible to icon-only (56px).

### State Management

Activate Zustand (already in package.json, unused):

```
src/stores/layoutStore.ts
  - activePanel: PanelId (default: "slack")
  - sidebarCollapsed: boolean
  - toggleSidebar()
  - setActivePanel(id)
```

### Typography Upgrade

| Element | Current | New |
|---------|---------|-----|
| Panel title | 11px Orbitron | 16px Orbitron |
| Body text | 12-13px Rajdhani | 15px Rajdhani |
| Labels/meta | 9-10px mono | 12px mono |
| Badges | 10px mono | 11px mono |
| Base font-size | 15px | 16px |

Increase padding throughout: panel content 12px → 20px, card padding 12px → 16px, gaps 12px → 16px.

### Files to Create
- `src/stores/layoutStore.ts` — Zustand store for layout state
- `src/components/layout/AppShell.tsx` + `.module.css` — Sidebar + main content wrapper
- `src/components/layout/Sidebar.tsx` + `.module.css` — Nav items, summary badges, collapse
- `src/components/layout/SidebarNavItem.tsx` + `.module.css` — Individual nav item
- `src/components/layout/MainContent.tsx` + `.module.css` — Active panel host with transitions

### Files to Modify
- `src/App.tsx` — Replace `DashboardGrid` with `AppShell`, remove panel toggle state
- `src/components/layout/TitleBar.tsx` — Remove panel toggle buttons, simplify to logo + title + controls
- `src/components/layout/Panel.tsx` + `.module.css` — Full-width mode, bigger header fonts, more padding
- `src/theme/variables.css` — Add `--sidebar-width`, `--sidebar-width-collapsed`, increase `--gap-md`
- `src/panels/slack/SlackPanel.module.css` — Increase all font sizes
- `src/panels/gitlab/GitLabPanel.module.css` — Increase all font sizes
- `src/panels/linear/LinearPanel.module.css` — Increase all font sizes
- `src/panels/agents/AgentsPanel.module.css` — Increase all font sizes

### Files Retired
- `src/components/layout/DashboardGrid.tsx` + `.module.css` — No longer used
- `src/components/layout/EmptySlot.tsx` + `.module.css` — No longer used

### Theme Notes
- Sidebar needs cyberpunk variant (neon border, glow on active item) and LCARS variant (24px L-frame sidebar, orange/tan pill nav items on black)
- Each theme definition in `src/themes/*.ts` needs no changes for this phase — sidebar uses existing CSS variables

---

## Phase 2: Lava Lamp Background

**Why second:** Quick visual win that fills the empty space behind panels. Independent of everything else.

### Approach

Pure CSS: 4-6 large blurred gradient blobs positioned absolutely behind all content, animated on slow looping paths (20-40s per cycle). GPU-accelerated via `transform` + `filter: blur(100px)`. Theme-aware colors.

```tsx
// LavaBackground.tsx — renders behind everything at z-index: 0
<div className={styles.container}>  {/* position:fixed, inset:0, overflow:hidden, pointer-events:none */}
  <div className={`${styles.blob} ${styles.blob1}`} />  {/* 300px, cyan, path A */}
  <div className={`${styles.blob} ${styles.blob2}`} />  {/* 350px, magenta, path B */}
  <div className={`${styles.blob} ${styles.blob3}`} />  {/* 250px, purple, path C */}
  <div className={`${styles.blob} ${styles.blob4}`} />  {/* 400px, cyan, path D */}
</div>
```

### Files to Create
- `src/components/layout/LavaBackground.tsx` + `.module.css`

### Files to Modify
- `src/App.tsx` — Add `<LavaBackground />` as first child (z-index: 0)
- `src/themes/types.ts` — Add `lavaLamp: boolean` to `AnimationFlags`, add `"--lava-blob-1"` through `"--lava-blob-4"` + `"--lava-blob-opacity"` to `ThemeCSSVariables`
- `src/themes/cyberpunk.ts` — Set blob colors (cyan, magenta, purple, cyan-dim), opacity 0.12-0.15
- `src/themes/trek-tng.ts` — Set blob colors (orange, tan, blue), maybe disable (`lavaLamp: false` — test if it clashes with LCARS)
- `src/themes/trek-tos.ts` — Set blob colors (gold, blue, red)
- `src/theme/animations.css` — Add `@keyframes blob-drift-1` through `blob-drift-4` with unique movement paths

### Performance
- `will-change: transform` on blobs
- `pointer-events: none` on container
- Respect `prefers-reduced-motion` media query
- 4 blobs max for safety (~2-3% GPU)

---

## Phase 3: AI Built Into Everything

**Why third:** Needs the sidebar layout in place. The terminal drawer and context menus are the core AI infrastructure that Phase 4 builds on.

### Three Sub-Features

#### 3A: Context Action Menus

Add a `...` button to every Slack message card, GitLab MR card, and Linear issue card. Clicking shows a dropdown with AI-powered actions:

**Slack message actions:**
- "Investigate This" — research what the message is about, find relevant code
- "Summarize Thread" — summarize the conversation
- "Create Ticket" — extract action item and create Linear ticket

**GitLab MR actions:**
- "Review This MR" — trigger `/gitlab-review-mr`
- "Fix Pipeline" — trigger `/gitlab-manage-mr-ci-pipeline`
- "Summarize Changes" — describe what the MR does

**Linear issue actions:**
- "Enrich Ticket" — trigger `/linear-enrich-ticket`
- "Work on This" — trigger `/linear-work-on-ticket`
- "Create Tech Design" — trigger `/linear-create-tech-design-from-project`

Each action pre-fills context (message text, MR ID, issue identifier) and dispatches to the agent system.

#### 3B: Embedded Terminal (xterm.js)

Replace the Markdown-rendered agent output with a real terminal emulator. The terminal lives in a slide-out drawer (from the right or bottom of the main content area). When an AI action fires, the terminal drawer opens and shows live streaming output.

**New npm deps:** `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`

#### 3C: PTY Support in Rust

Add a Rust command that spawns Claude CLI in a real PTY (not just `--print`). This gives full terminal output with ANSI colors and formatting. Use the `portable-pty` crate.

**New Cargo dep:** `portable-pty = "0.8"`

### Shared Agent State (Zustand)

```
src/stores/agentStore.ts
  - tasks: RunningTask[]
  - activeTaskId: string | null
  - terminalDrawerOpen: boolean
  - addTask(task)
  - updateTaskOutput(taskId, line)
  - completeTask(taskId)
  - setActiveTask(taskId)
  - toggleTerminalDrawer()
```

### Files to Create
- `src/stores/agentStore.ts` — Shared task state across all panels
- `src/components/ai/ActionMenu.tsx` + `.module.css` — Reusable dropdown for AI actions
- `src/components/ai/TerminalDrawer.tsx` + `.module.css` — Slide-out panel with xterm.js
- `src/components/ai/TerminalInstance.tsx` + `.module.css` — Single xterm.js terminal
- `src/config/aiActions.ts` — Action definitions per source type with context builders

### Files to Modify
- `src/panels/slack/SlackPanel.tsx` — Add `<ActionMenu>` to each message card
- `src/panels/gitlab/GitLabPanel.tsx` — Add `<ActionMenu>` to each MR card
- `src/panels/linear/LinearPanel.tsx` — Add `<ActionMenu>` to each issue card
- `src/panels/agents/AgentsPanel.tsx` — Migrate task state to `agentStore`, use terminal drawer for output
- `src/App.tsx` — Add `<TerminalDrawer />` overlay
- `src-tauri/src/commands/agent.rs` — Add `spawn_agent_pty`, `write_agent_pty`, `kill_agent_pty` commands
- `src-tauri/Cargo.toml` — Add `portable-pty = "0.8"`
- `src/services/tauri-bridge.ts` — Add PTY bridge functions
- `src/types/models.ts` — Extend `AgentTask` with `mode`, `contextSource`, `contextData`

---

## Phase 4: Agent Personas + Orchestration

**Why fourth:** Builds on Phase 3's terminal, agent store, and action menu infrastructure.

### Concept

Named personas (Scout, Architect, Builder, Reviewer, Ops) are specialized agents with distinct system prompts and roles. Users compose a "squad" by selecting personas, give them a task, and they execute sequentially — each persona's output becomes context for the next.

### Default Personas
| Persona | Role | Color | Icon |
|---------|------|-------|------|
| Scout | Research & recon | cyan | Search |
| Architect | System design & planning | purple | Compass |
| Builder | Implementation & coding | orange | Hammer |
| Reviewer | Code review & quality | magenta | Eye |
| Ops | DevOps & deployment | green | Server |

### Orchestration Flow
```
User selects: [Scout → Architect → Builder]
User enters task: "Add caching to user profile endpoint"

1. Spawn Claude with Scout system prompt + task → output A
2. Spawn Claude with Architect system prompt + task + output A → output B
3. Spawn Claude with Builder system prompt + task + output B → output C
4. Mission complete — timeline shows all three outputs with handoff points
```

### UI: Mission Control

Replace/augment the Agents panel with:
1. **Persona picker** — grid of persona cards, click to add to squad, drag to reorder
2. **Squad builder** — horizontal strip showing selected personas in order
3. **Task input** — text area for the mission description
4. **Mission timeline** — vertical timeline showing each persona's status (waiting → active → done), expandable output per persona, handoff indicators

### Persona Config Storage

Defaults are hardcoded. User customizations saved to `~/.config/daemon/personas.json`. Users can edit system prompts, add new personas, change icons/colors.

### Files to Create
- `src/config/personas.ts` — Default persona definitions + loader
- `src/config/personaTypes.ts` — TypeScript interfaces
- `src/stores/personaStore.ts` — Zustand: personas, squads, active mission
- `src/panels/agents/PersonaPicker.tsx` + `.module.css`
- `src/panels/agents/PersonaCard.tsx` + `.module.css`
- `src/panels/agents/MissionControl.tsx` + `.module.css`

### Files to Modify
- `src/panels/agents/AgentsPanel.tsx` — Add mode tabs: "Commands" (existing) + "Personas" (new)
- `src-tauri/src/commands/agent.rs` — Add `run_persona_chain` command (sequential Claude invocations with different system prompts, emitting events per persona)
- `src-tauri/src/models/agent.rs` — Add `PersonaConfig`, `Squad`, `MissionTask` types
- `src/types/models.ts` — Mirror Rust types
- `src/services/tauri-bridge.ts` — Add `runPersonaChain()`, `loadPersonas()`, `savePersonas()`

---

## Phase 5: Automated To-Dos

**Why last:** Aggregates data from Slack, GitLab, and Linear — benefits from all prior infrastructure. Can leverage AI actions from Phase 3 for smart extraction.

### Concept

A new "To-Dos" sidebar section that scans all connected tools and surfaces action items. Most items are links back to the source tool (don't recreate the tool, just point to it). Users configure per-channel/per-source scan rules that can be changed on the fly.

### Todo Item Types
- **Linked** — points to source (Slack permalink, Linear URL, GitLab MR URL). Regenerated each poll.
- **Pinned** — user-pinned item that persists even if scan rule no longer matches.
- **Dismissed** — hidden until source data changes.

### Default Extraction Rules (built-in, no config needed)

| Source | Rule | Priority |
|--------|------|----------|
| GitLab | MRs needing your approval | High |
| GitLab | Your MRs with failed pipelines | High |
| GitLab | MRs with unresolved threads mentioning you | Medium |
| Linear | Issues assigned to you, status "In Progress" | Medium |
| Linear | Issues assigned to you, status "Ready to Start" | Medium |
| Slack | Messages @mentioning you | Medium |

### User-Configurable Rules

Users can add per-channel Slack scan rules via a rules editor:
- Channel + keyword list (e.g., scan #customer-issues for "urgent", "blocker")
- Toggle AI extraction per channel (uses Claude to find action items — opt-in due to cost)
- Enable/disable any default rule

Rules stored in `~/.config/daemon/todo-rules.json`.

### Files to Create
- `src/panels/todos/TodosPanel.tsx` + `.module.css` — Main to-do list view
- `src/panels/todos/TodoItem.tsx` + `.module.css` — Individual to-do card
- `src/panels/todos/TodoRulesEditor.tsx` + `.module.css` — Scan rule configuration UI
- `src/stores/todoStore.ts` — Zustand: rules, pinned IDs, dismissed IDs
- `src/hooks/useTodos.ts` — TanStack Query hook for aggregated to-dos
- `src-tauri/src/commands/todos.rs` — Rust: aggregate to-dos, manage rules
- `src-tauri/src/services/todo_aggregator.rs` — Core rule evaluation logic
- `src-tauri/src/models/todo.rs` — TodoItem, TodoRule types

### Files to Modify
- `src/App.tsx` — Add TodosPanel to panel registry
- `src/components/layout/Sidebar.tsx` — Add "To-Dos" nav item with count badge
- `src-tauri/src/commands/mod.rs` — Register todos module
- `src-tauri/src/models/mod.rs` — Register todo module
- `src-tauri/src/services/mod.rs` — Register aggregator module
- `src-tauri/src/lib.rs` — Register new Tauri commands
- `src/services/tauri-bridge.ts` — Add todo bridge functions
- `src/types/models.ts` — Add TodoItem, TodoRule interfaces

### Aggregation Strategy

The Rust aggregator reuses data from existing API calls (same endpoints that Slack/GitLab/Linear panels use). It runs rule evaluation on top of cached responses to avoid duplicate network calls. TanStack Query on the frontend polls the aggregation endpoint on its own interval (30-60s).

---

## Verification Plan

After each phase, verify:

1. **Phase 1:** `npm run tauri dev` → sidebar visible with all 4 nav items, clicking switches panels, text is noticeably larger, sidebar collapses to icons, both cyberpunk and LCARS themes render correctly
2. **Phase 2:** Colored blobs drift behind panels, respect theme colors, don't block clicks, performance stays smooth
3. **Phase 3:** Right-click or `...` menu on a Slack message → "Investigate This" → terminal drawer opens with streaming Claude output. Same for GitLab MRs and Linear issues.
4. **Phase 4:** Agents panel → Personas tab → select Scout + Builder → enter task → timeline shows Scout working, then handoff to Builder, both outputs visible
5. **Phase 5:** To-Dos sidebar item shows count badge → click shows aggregated items from all sources → items link to source tools → rules editor allows adding channel keywords
