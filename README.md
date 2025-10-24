# Claude Code Diffs

A VS Code extension that tracks and visualizes file changes during Claude Code sessions. This is a heuristic tracker designed to give you visibility into what Claude is working on and what modifications are being made.

This extension is not a Git replacement. It is simply a tool to understand what changes are happening in real-time during development sessions with Claude Code.

## Features

**Automatic Change Tracking**: Parses Claude Code session `.jsonl` files to identify all file modifications automatically.

**Live Diff Viewing**: Opens diff views automatically when Claude makes changes, allowing real-time observation of modifications.

**Change History**: Browse all changes chronologically with a dedicated tree view in the activity bar.

**Session Management**: View changes from the current session or include past sessions for complete history.

**Heuristic Tracking (Experimental)**: Detects file changes from any source, not just Claude Code, useful for other AI CLI tools like Qwen.

**Multi-Instance Support**: Automatically detects Claude installations in standard locations or use custom paths for multiple instances.

## Commands

### `Claude Code: Show Session Changes`
Display all file changes from the current Claude Code session in an interactive menu. Select any change to view its diff.

### `Claude Code: Show Recent Diffs`
Display the most recent changes with a summary in the output panel and a selection menu.

### `Claude Code Diffs: Show Changes Summary`
Generate a text summary of all changes grouped by file in the output panel.

### `Claude Code Diffs: Refresh Changes`
Manually refresh the changes tree view to reload session data.

### `Claude Code Diffs: Close All Diffs`
Close all currently open diff editor tabs at once.

### `Claude Code Diffs: Show Deletions`
View files that were deleted during the session.

### `Claude Code Diffs: Toggle Open Diffs in Multiple Tabs`
Toggle between opening diffs in multiple tabs or replacing the current diff tab.

## How It Works

### Claude Code Integration (Production-Ready)

The extension reads Claude Code session files located in:
- `~/.claude/projects/`
- `~/.claude-gpt5/projects/`
- Custom paths via `claudeCodeDiff.claudeInstancePaths` configuration

These `.jsonl` files contain a complete log of all interactions, including:
- **Edit operations**: Targeted changes with `old_string` and `new_string` parameters
- **Write operations**: Full file writes or rewrites

The extension parses these events, extracts the changes, and displays them using VS Code's native diff API.

### Heuristic Tracking (Experimental)

The heuristic tracker is an experimental feature that monitors file changes through VS Code's file system events rather than parsing session files. This enables tracking changes from:
- Qwen or other AI CLI tools
- Manual edits
- Any file modification regardless of source

**Current Status**: The heuristic tracker needs additional work to be fully compatible with non-Claude clients. It is functional but may require tuning for optimal performance with different AI tools.

**Note**: The Claude Code integration is approximately 100% complete and production-ready. The heuristic tracker is the component that requires further development for broader compatibility.

## Configuration

### Basic Settings

**`claudeCodeDiff.sessionPath`** (string, default: `""`)
Custom path to Claude Code sessions directory. Auto-detected if left empty.

**`claudeCodeDiff.maxChangesToShow`** (number, default: `50`)
Maximum number of recent changes to display in commands.

**`claudeCodeDiff.autoRefresh`** (boolean, default: `true`)
Automatically refresh changes when session files are modified.

**`claudeCodeDiff.showPastSessionChanges`** (boolean, default: `false`)
Include changes from previous sessions in addition to the current session.

**`claudeCodeDiff.claudeInstancePaths`** (array, default: `[]`)
Custom paths to Claude instance directories. Example:
```json
["C:\\Users\\YourName\\.claude", "/home/user/.claude-gpt5"]
```

### Live Mode Settings

**`claudeCodeDiff.showDiffsLive`** (boolean, default: `false`)
Automatically open diff view when Claude makes changes to files.

**`claudeCodeDiff.liveDelay`** (number, default: `1000`)
Delay in milliseconds before opening diff in live mode to avoid spam.

**`claudeCodeDiff.liveNotifications`** (boolean, default: `true`)
Show notifications when opening diffs in live mode.

**`claudeCodeDiff.liveMultipleDiffs`** (boolean, default: `true`)
Open multiple diffs simultaneously instead of replacing the previous one.

**`claudeCodeDiff.liveMaxOpenDiffs`** (number, default: `5`)
Maximum number of diff tabs to keep open simultaneously. Set to `0` for unlimited.

**`claudeCodeDiff.openDiffsOnStartup`** (boolean, default: `false`)
Automatically open diffs when VS Code starts (only applies when live mode is enabled).

### Heuristic Tracker Settings (Experimental)

**`claudeCodeDiff.enableHeuristicTracker`** (boolean, default: `false`)
Enable heuristic file change tracking. Detects changes from any source, not just Claude Code.

**`claudeCodeDiff.heuristicTrackerDelay`** (number, default: `500`)
Delay in milliseconds before capturing changes in heuristic mode.

**`claudeCodeDiff.heuristicTrackerNotifications`** (boolean, default: `false`)
Show notifications when heuristic tracker detects changes.

**`claudeCodeDiff.heuristicExcludePatterns`** (array)
Glob patterns for files/folders to exclude from heuristic tracking. Default patterns exclude common build outputs, dependencies, and configuration files like:
- `**/node_modules/**`
- `**/dist/**`, `**/build/**`, `**/out/**`
- `**/.venv/**`, `**/venv/**`
- `**/.git/**`, `**/.vscode/**`
- Package manager lock files
- IDE configuration files

## Usage

### Viewing Changes

1. Open a workspace where you have used Claude Code
2. Look for the Claude Code Diffs icon in the activity bar (diff icon)
3. The tree view will automatically load and display session changes
4. Click on any change to open its diff view
5. Use the refresh button to reload changes manually

### Using Commands

1. Open the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Type "Claude Code" to see all available commands
3. Select the desired command

### Live Mode

Enable live mode to automatically see diffs as Claude makes changes:

1. Open VS Code settings
2. Search for "Claude Code Diffs"
3. Enable `showDiffsLive`
4. Adjust delay and notification settings as needed
5. Now whenever Claude modifies a file, the diff will open automatically

### Heuristic Tracking (Experimental)

To track changes from other AI tools or any file modifications:

1. Enable `enableHeuristicTracker` in settings
2. Adjust `heuristicExcludePatterns` to filter out unwanted files
3. Changes from any source will now be tracked and displayed
4. Note: This feature is experimental and may require tuning for non-Claude tools

## Project Structure

```
src/
├── types/
│   └── session-events.ts         # TypeScript types for session events
├── parsers/
│   └── session-parser.ts         # Parser for .jsonl session files
├── diff-tracker/
│   └── diff-tracker.ts           # Diff manager using VS Code API
├── live-mode/
│   └── live-diff-tracker.ts      # Live mode change detection
├── heuristic-tracker/
│   └── heuristic-tracker.ts      # Heuristic file change tracker (experimental)
├── views/
│   └── changes-tree-provider.ts  # Tree view provider for activity bar
└── extension.ts                  # Extension entry point
```

## Architecture Overview

The extension consists of two main tracking systems:

1. **Claude Code Tracker (Production-Ready)**
   - Parses `.jsonl` session files
   - Extracts Edit and Write operations
   - Near 100% completion for Claude Code integration
   - Reliable and battle-tested

2. **Heuristic Tracker (Experimental)**
   - Monitors VS Code file system events
   - Source-agnostic tracking
   - Requires additional development for non-Claude tools
   - Configurable exclude patterns

## Development

### Setup

```bash
npm install
npm run compile
```

### Running

Press `F5` in VS Code to launch the extension in debug mode.

### Building

```bash
npm run vscode:prepublish
```

### Linting

```bash
npm run lint
```

## Requirements

- VS Code 1.80.0 or higher
- Claude Code installed and configured (for Claude integration)
- Active sessions in `~/.claude/` or `~/.claude-gpt5/` (for Claude integration)
- For heuristic tracking: Any workspace with file changes

### Platform Compatibility

**Linux**: Fully tested and working. Auto-detection of Claude paths works out of the box.

**Windows/macOS**: The extension uses cross-platform path handling and should work correctly. If auto-detection fails, you can manually configure the Claude instance paths using the `claudeCodeDiff.claudeInstancePaths` setting:

```json
{
  "claudeCodeDiff.claudeInstancePaths": [
    "C:\\Users\\YourName\\.claude",  // Windows example
    "/Users/yourname/.claude"         // macOS example
  ]
}
```

The extension will automatically handle path encoding for workspaces on any platform.

## Inspiration

Based on the `claudehooks` scripts that process Claude Code session files for various purposes including supervisor generation and session analysis.

## Known Limitations

- Heuristic tracker may require tuning for optimal compatibility with AI tools other than Claude Code
- Live mode can generate many diff tabs if not configured with appropriate delays
- Very large sessions may take time to parse initially

## Future Work

- Improve heuristic tracker compatibility with Qwen and other AI CLI tools
- Add filtering and search capabilities in tree view
- Support for custom diff styles and themes
- Session comparison and diff between sessions
- Export changes to patch files

## License

MIT
