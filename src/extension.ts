import * as vscode from 'vscode';
import { SessionParser } from './parsers/session-parser';
import { DiffTracker } from './diff-tracker/diff-tracker';
import { ChangesTreeProvider } from './views/changes-tree-provider';
import { LiveDiffTracker } from './live-mode/live-diff-tracker';
import { HeuristicTracker } from './heuristic-tracker/heuristic-tracker';

export function activate(context: vscode.ExtensionContext) {
  console.log('Claude Code Diffs extension activated');

  const parser = new SessionParser();
  const diffTracker = new DiffTracker(context);

  // Create live diff tracker (without output channel)
  const liveDiffTracker = new LiveDiffTracker(diffTracker);

  // Create heuristic tracker (for non-Claude changes)
  const heuristicTracker = new HeuristicTracker(diffTracker, context);

  // Create tree view
  const treeProvider = new ChangesTreeProvider(parser, heuristicTracker);
  const treeView = vscode.window.createTreeView('claudeCodeDiffs.changesView', {
    treeDataProvider: treeProvider,
    showCollapseAll: true
  });

  // Load changes on activation
  const loadChanges = async (isStartup: boolean = false) => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const workspacePath = workspaceFolders[0].uri.fsPath;
      const config = vscode.workspace.getConfiguration('claudeCodeDiff');
      const showPastSessions = config.get<boolean>('showPastSessionChanges', false);
      await treeProvider.loadChanges(workspacePath, showPastSessions);

      // Process changes for live mode
      const openOnStartup = config.get<boolean>('openDiffsOnStartup', false);

      // Process changes for live mode
      const changes = parser.getCurrentSessionChanges(workspacePath);

      // Skip opening diffs on startup unless explicitly enabled
      const skipDiffs = isStartup && !openOnStartup;
      if (skipDiffs) {
        console.log('[Extension] Skipping diff opening on startup (openDiffsOnStartup=false)');
      }

      await liveDiffTracker.processChanges(changes, skipDiffs);
    }
  };

  // Configure live mode from settings
  const configureLiveMode = () => {
    const config = vscode.workspace.getConfiguration('claudeCodeDiff');
    const enabled = config.get<boolean>('showDiffsLive', false);
    const delay = config.get<number>('liveDelay', 1000);

    liveDiffTracker.setEnabled(enabled);
    liveDiffTracker.setDelay(delay);
  };

  // Configure heuristic tracker from settings
  const configureHeuristicTracker = () => {
    const config = vscode.workspace.getConfiguration('claudeCodeDiff');
    const enabled = config.get<boolean>('enableHeuristicTracker', false);
    const delay = config.get<number>('heuristicTrackerDelay', 500);
    const notifications = config.get<boolean>('heuristicTrackerNotifications', false);

    heuristicTracker.setEnabled(enabled);
    heuristicTracker.setDelay(delay);
    heuristicTracker.setShowNotifications(notifications);
  };

  // Initial configuration
  configureLiveMode();
  configureHeuristicTracker();

  // Initial load (mark as startup)
  loadChanges(true);

  // Watch for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('claudeCodeDiff.showPastSessionChanges')) {
        console.log('[Extension] Configuration changed, reloading...');
        loadChanges();
      }

      if (e.affectsConfiguration('claudeCodeDiff.showDiffsLive') ||
          e.affectsConfiguration('claudeCodeDiff.liveDelay')) {
        console.log('[Extension] Live mode configuration changed');
        configureLiveMode();
      }

      if (e.affectsConfiguration('claudeCodeDiff.enableHeuristicTracker') ||
          e.affectsConfiguration('claudeCodeDiff.heuristicTrackerDelay') ||
          e.affectsConfiguration('claudeCodeDiff.heuristicTrackerNotifications')) {
        console.log('[Extension] Heuristic tracker configuration changed');
        configureHeuristicTracker();
      }
    })
  );

  // Refresh on file changes (if enabled)
  const config = vscode.workspace.getConfiguration('claudeCodeDiff');
  if (config.get<boolean>('autoRefresh', true)) {
    // Watch workspace files
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{js,ts,jsx,tsx,py,java,go,rs}');
    fileWatcher.onDidChange(() => loadChanges());
    context.subscriptions.push(fileWatcher);

    // Watch Claude session files
    const claudeInstances = parser.findClaudeInstances();
    for (const instancePath of claudeInstances) {
      const sessionPattern = new vscode.RelativePattern(
        instancePath,
        'projects/**/*.jsonl'
      );
      const sessionWatcher = vscode.workspace.createFileSystemWatcher(sessionPattern);

      sessionWatcher.onDidChange((uri) => {
        console.log('[Extension] Session file changed:', uri.fsPath);
        setTimeout(async () => {
          await loadChanges();
        }, 500); // Small delay to ensure file is written
      });

      context.subscriptions.push(sessionWatcher);
    }
  }

  // Register heuristic tracker listeners
  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument(event => {
      heuristicTracker.onWillSaveTextDocument(event);
    }),
    vscode.workspace.onDidOpenTextDocument(doc => {
      heuristicTracker.onDidOpenTextDocument(doc);
    }),
    vscode.workspace.onDidCloseTextDocument(doc => {
      heuristicTracker.onDidCloseTextDocument(doc);
    })
  );

  // Command: Show session changes
  const showSessionChanges = vscode.commands.registerCommand(
    'claudeCodeDiff.showSessionChanges',
    async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;

      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const workspacePath = workspaceFolders[0].uri.fsPath;

      // Show progress
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Loading Claude Code session changes...',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 30 });

          // Get changes from current session
          let changes = parser.getCurrentSessionChanges(workspacePath);

          // If no changes found for current workspace, try searching all recent sessions
          if (changes.length === 0) {
            console.log('[Extension] No changes in current workspace, searching all workspaces...');
            vscode.window.showInformationMessage(
              'No session found for current workspace. Searching all recent sessions...'
            );

            progress.report({ increment: 20 });
            changes = parser.getAllRecentChanges(100);
          }

          progress.report({ increment: 40 });

          if (changes.length === 0) {
            vscode.window.showInformationMessage(
              'No file changes found in any Claude Code session. Check Developer Console for logs.'
            );
            return;
          }

          progress.report({ increment: 10 });

          // Show changes in quick pick
          await diffTracker.showChangesQuickPick(changes);
        }
      );
    }
  );

  // Command: Show recent diffs
  const showRecentDiffs = vscode.commands.registerCommand(
    'claudeCodeDiff.showRecentDiffs',
    async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;

      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const workspacePath = workspaceFolders[0].uri.fsPath;

      // Get max changes from configuration
      const config = vscode.workspace.getConfiguration('claudeCodeDiff');
      const maxChanges = config.get<number>('maxChangesToShow', 50);

      // Show progress
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Loading recent changes...',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 30 });

          // Get recent changes
          const changes = parser.getRecentChanges(workspacePath, maxChanges);

          progress.report({ increment: 40 });

          if (changes.length === 0) {
            vscode.window.showInformationMessage(
              'No recent changes found'
            );
            return;
          }

          progress.report({ increment: 20 });

          // Show info message with summary
          const grouped = diffTracker.groupChangesByFile(changes);
          vscode.window.showInformationMessage(
            `Found ${changes.length} changes in ${grouped.size} files`
          );

          // Show quick pick for detailed view
          await diffTracker.showChangesQuickPick(changes);
        }
      );
    }
  );

  // Command: Show changes summary
  const showChangesSummary = vscode.commands.registerCommand(
    'claudeCodeDiff.showChangesSummary',
    async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;

      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const workspacePath = workspaceFolders[0].uri.fsPath;

      // Get changes
      const changes = parser.getCurrentSessionChanges(workspacePath);

      if (changes.length === 0) {
        vscode.window.showInformationMessage(
          'No file changes found in current session'
        );
        return;
      }

      // Show summary notification and quick pick
      const grouped = diffTracker.groupChangesByFile(changes);
      vscode.window.showInformationMessage(
        `Found ${changes.length} changes in ${grouped.size} files`
      );

      await diffTracker.showChangesQuickPick(changes);
    }
  );

  // Command: Refresh changes
  const refreshChanges = vscode.commands.registerCommand(
    'claudeCodeDiff.refreshChanges',
    async () => {
      await loadChanges();
      vscode.window.showInformationMessage('Changes refreshed');
    }
  );

  // Command: View diff (from tree view)
  const viewDiff = vscode.commands.registerCommand(
    'claudeCodeDiff.viewDiff',
    async (change) => {
      if (change) {
        await diffTracker.showDiff(change);
      }
    }
  );

  // Command: Close all diffs
  const closeAllDiffs = vscode.commands.registerCommand(
    'claudeCodeDiff.closeAllDiffs',
    async () => {
      await diffTracker.closeAllDiffs();
      vscode.window.showInformationMessage('All diffs closed');
    }
  );

  // Command: Show deletions only
  const showDeletions = vscode.commands.registerCommand(
    'claudeCodeDiff.showDeletions',
    async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;

      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const workspacePath = workspaceFolders[0].uri.fsPath;

      // Get all changes
      const changes = parser.getCurrentSessionChanges(workspacePath);

      if (changes.length === 0) {
        vscode.window.showInformationMessage(
          'No changes found in current session'
        );
        return;
      }

      // Show only deletions
      await diffTracker.showDeletionsQuickPick(changes);
    }
  );

  // Command: Toggle multiple diffs
  const toggleMultipleDiffs = vscode.commands.registerCommand(
    'claudeCodeDiff.toggleMultipleDiffs',
    async () => {
      const config = vscode.workspace.getConfiguration('claudeCodeDiff');
      const currentValue = config.get<boolean>('liveMultipleDiffs', true);
      const newValue = !currentValue;

      try {
        // Update in global settings (persists across all workspaces)
        await config.update('liveMultipleDiffs', newValue, vscode.ConfigurationTarget.Global);

        // Verify the change was applied
        const updatedConfig = vscode.workspace.getConfiguration('claudeCodeDiff');
        const verifiedValue = updatedConfig.get<boolean>('liveMultipleDiffs');

        console.log(`[Extension] Multiple diffs toggled: ${currentValue} -> ${verifiedValue}`);

        const status = verifiedValue ? 'ENABLED' : 'DISABLED';
        const icon = verifiedValue ? '✓' : '✗';

        vscode.window.showInformationMessage(
          `${icon} Multiple diff tabs: ${status} (applies to all workspaces)`
        );
      } catch (error) {
        console.error('[Extension] Error toggling multiple diffs:', error);
        vscode.window.showErrorMessage(
          `Failed to toggle setting: ${error}`
        );
      }
    }
  );

  context.subscriptions.push(
    treeView,
    showSessionChanges,
    showRecentDiffs,
    showChangesSummary,
    refreshChanges,
    viewDiff,
    closeAllDiffs,
    showDeletions,
    toggleMultipleDiffs
  );
}

export function deactivate() {
  console.log('Claude Code Diffs extension deactivated');
}
