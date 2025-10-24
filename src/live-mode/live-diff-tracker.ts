import * as vscode from 'vscode';
import { FileChange } from '../types/session-events';
import { DiffTracker } from '../diff-tracker/diff-tracker';

/**
 * Tracks changes in live mode and automatically opens diffs
 */
export class LiveDiffTracker {
  private lastSeenChanges: Set<string> = new Set();
  private pendingDiffs: Map<string, NodeJS.Timeout> = new Map();
  private isEnabled: boolean = false;
  private delay: number = 1000;

  constructor(
    private diffTracker: DiffTracker
  ) {}

  /**
   * Enable or disable live mode
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    console.log(`[LiveDiffTracker] Live mode ${enabled ? 'enabled' : 'disabled'}`);

    if (enabled) {
      vscode.window.showInformationMessage('Live Diff Mode enabled - diffs will open automatically');
    } else {
      // Cancel any pending diffs
      for (const timeout of this.pendingDiffs.values()) {
        clearTimeout(timeout);
      }
      this.pendingDiffs.clear();
    }
  }

  /**
   * Set delay before opening diffs
   */
  setDelay(delay: number): void {
    this.delay = delay;
    console.log(`[LiveDiffTracker] Delay set to ${delay}ms`);
  }

  /**
   * Process new changes and open diffs for new ones
   */
  async processChanges(changes: FileChange[], skipOnStartup: boolean = false): Promise<void> {
    if (!this.isEnabled || changes.length === 0) {
      return;
    }

    if (skipOnStartup) {
      console.log(`[LiveDiffTracker] Skipping ${changes.length} changes (startup mode with openDiffsOnStartup=false)`);
      return;
    }

    console.log(`[LiveDiffTracker] Processing ${changes.length} changes`);

    // Identify new changes
    const newChanges: FileChange[] = [];

    for (const change of changes) {
      const changeKey = this.getChangeKey(change);

      if (!this.lastSeenChanges.has(changeKey)) {
        newChanges.push(change);
        this.lastSeenChanges.add(changeKey);
      }
    }

    if (newChanges.length === 0) {
      console.log('[LiveDiffTracker] No new changes detected');
      return;
    }

    console.log(`[LiveDiffTracker] Found ${newChanges.length} new changes`);

    // Schedule diffs with delay
    for (const change of newChanges) {
      this.scheduleDiff(change);
    }
  }

  /**
   * Schedule a diff to be opened after delay
   */
  private scheduleDiff(change: FileChange): void {
    const changeKey = this.getChangeKey(change);

    // Cancel existing timeout if any
    if (this.pendingDiffs.has(changeKey)) {
      clearTimeout(this.pendingDiffs.get(changeKey)!);
    }

    // Schedule new diff
    const timeout = setTimeout(async () => {
      try {
        console.log(`[LiveDiffTracker] Opening diff for: ${change.filePath}`);

        // Show notification with file name
        const fileName = change.filePath.split('/').pop() || change.filePath;
        const config = vscode.workspace.getConfiguration('claudeCodeDiff');
        const showNotifications = config.get<boolean>('liveNotifications', true);

        if (showNotifications) {
          vscode.window.showInformationMessage(
            `[${change.toolName}] ${fileName}`
          );
        }

        await this.diffTracker.showDiff(change);
      } catch (error) {
        console.error('[LiveDiffTracker] Error opening diff:', error);
        vscode.window.showErrorMessage(`Failed to open diff: ${error}`);
      } finally {
        this.pendingDiffs.delete(changeKey);
      }
    }, this.delay);

    this.pendingDiffs.set(changeKey, timeout);
  }

  /**
   * Generate unique key for a change
   */
  private getChangeKey(change: FileChange): string {
    return `${change.sessionId}:${change.messageUuid}:${change.filePath}`;
  }

  /**
   * Reset seen changes (useful when switching workspaces)
   */
  reset(): void {
    console.log('[LiveDiffTracker] Resetting state');
    this.lastSeenChanges.clear();

    // Cancel pending diffs
    for (const timeout of this.pendingDiffs.values()) {
      clearTimeout(timeout);
    }
    this.pendingDiffs.clear();
  }

  /**
   * Cleanup
   */
  dispose(): void {
    this.reset();
  }
}
