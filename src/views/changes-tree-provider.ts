import * as vscode from 'vscode';
import * as path from 'path';
import { FileChange } from '../types/session-events';
import { SessionParser } from '../parsers/session-parser';

/**
 * Tree item for file changes
 */
class FileChangeTreeItem extends vscode.TreeItem {
  constructor(
    public readonly change: FileChange,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(path.basename(change.filePath), collapsibleState);

    this.contextValue = 'fileChange';
    this.resourceUri = vscode.Uri.file(change.filePath);

    // Tooltip
    const timestamp = new Date(change.timestamp).toLocaleString();
    this.tooltip = `${change.toolName} - ${timestamp}\n${change.filePath}`;

    // Description (shown next to label)
    this.description = this.formatTimeAgo(change.timestamp);

    // Icon
    this.iconPath = new vscode.ThemeIcon(
      change.toolName === 'Edit' ? 'edit' : 'file-add',
      new vscode.ThemeColor(
        change.toolName === 'Edit' ? 'gitDecoration.modifiedResourceForeground' : 'gitDecoration.addedResourceForeground'
      )
    );

    // Command to view diff when clicked
    this.command = {
      command: 'claudeCodeDiff.viewDiff',
      title: 'View Diff',
      arguments: [change]
    };
  }

  private formatTimeAgo(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffDay > 0) return `${diffDay}d ago`;
    if (diffHour > 0) return `${diffHour}h ago`;
    if (diffMin > 0) return `${diffMin}m ago`;
    return 'just now';
  }
}

/**
 * Tree item for file groups
 */
class FileGroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly changes: FileChange[],
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(path.basename(filePath), collapsibleState);

    this.contextValue = 'fileGroup';
    this.resourceUri = vscode.Uri.file(filePath);

    // Description
    this.description = `${changes.length} change${changes.length > 1 ? 's' : ''}`;

    // Tooltip
    this.tooltip = `${filePath}\n${changes.length} modifications`;

    // Icon
    this.iconPath = new vscode.ThemeIcon('file');
  }
}

/**
 * Tree item for session groups
 */
class SessionGroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly sessionId: string,
    public readonly sessionFile: string,
    public readonly changes: FileChange[],
    public readonly isCurrent: boolean,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    const label = isCurrent ? '📍 Current Session' : `Session ${sessionId.substring(0, 8)}`;
    super(label, collapsibleState);

    this.contextValue = 'sessionGroup';

    // Description
    const timestamp = changes.length > 0
      ? this.formatTimeAgo(changes[0].timestamp)
      : '';
    this.description = `${changes.length} changes ${timestamp}`;

    // Tooltip
    const date = changes.length > 0
      ? new Date(changes[0].timestamp).toLocaleString()
      : '';
    this.tooltip = `Session: ${sessionId}\n${changes.length} file changes\nLast activity: ${date}`;

    // Icon
    this.iconPath = new vscode.ThemeIcon(
      isCurrent ? 'circle-filled' : 'history',
      new vscode.ThemeColor(isCurrent ? 'charts.green' : 'charts.blue')
    );
  }

  private formatTimeAgo(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffDay > 0) return `${diffDay}d ago`;
    if (diffHour > 0) return `${diffHour}h ago`;
    if (diffMin > 0) return `${diffMin}m ago`;
    return 'just now';
  }
}

type TreeElement = FileChangeTreeItem | FileGroupTreeItem | SessionGroupTreeItem;

/**
 * TreeView data provider for session changes
 */
export class ChangesTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeElement | undefined | null | void> = new vscode.EventEmitter<TreeElement | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeElement | undefined | null | void> = this._onDidChangeTreeData.event;

  private changes: FileChange[] = [];
  private sessionChanges: Map<string, { sessionFile: string; changes: FileChange[] }> = new Map();
  private groupByFile: boolean = true;
  private showPastSessions: boolean = false;
  private currentSessionId: string | null = null;

  constructor(private parser: SessionParser) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setChanges(changes: FileChange[]): void {
    this.changes = changes;
    this.refresh();
  }

  setSessionChanges(sessionChanges: Map<string, { sessionFile: string; changes: FileChange[] }>, currentSessionId: string | null): void {
    this.sessionChanges = sessionChanges;
    this.currentSessionId = currentSessionId;
    this.refresh();
  }

  setGroupByFile(group: boolean): void {
    this.groupByFile = group;
    this.refresh();
  }

  setShowPastSessions(show: boolean): void {
    this.showPastSessions = show;
    this.refresh();
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeElement): Promise<TreeElement[]> {
    if (!element) {
      // Root level
      if (this.showPastSessions && this.sessionChanges.size > 0) {
        // Show sessions as top-level groups
        const sessions: SessionGroupTreeItem[] = [];

        for (const [sessionId, data] of this.sessionChanges) {
          const isCurrent = sessionId === this.currentSessionId;
          sessions.push(new SessionGroupTreeItem(
            sessionId,
            data.sessionFile,
            data.changes,
            isCurrent,
            vscode.TreeItemCollapsibleState.Collapsed
          ));
        }

        // Sort: current session first, then by timestamp
        sessions.sort((a, b) => {
          if (a.isCurrent) return -1;
          if (b.isCurrent) return 1;
          // Sort by most recent
          const aTime = a.changes[0] ? new Date(a.changes[0].timestamp).getTime() : 0;
          const bTime = b.changes[0] ? new Date(b.changes[0].timestamp).getTime() : 0;
          return bTime - aTime;
        });

        return sessions;
      } else {
        // Show only current session changes
        if (this.changes.length === 0) {
          return [];
        }

        if (this.groupByFile) {
          // Group by file
          const grouped = this.groupChangesByFile(this.changes);
          return Array.from(grouped.entries()).map(([filePath, fileChanges]) => {
            return new FileGroupTreeItem(
              filePath,
              fileChanges,
              vscode.TreeItemCollapsibleState.Collapsed
            );
          });
        } else {
          // Flat list
          return this.changes.map(change => new FileChangeTreeItem(
            change,
            vscode.TreeItemCollapsibleState.None
          ));
        }
      }
    } else if (element instanceof SessionGroupTreeItem) {
      // Children of session: show files grouped
      const grouped = this.groupChangesByFile(element.changes);
      return Array.from(grouped.entries()).map(([filePath, fileChanges]) => {
        return new FileGroupTreeItem(
          filePath,
          fileChanges,
          vscode.TreeItemCollapsibleState.Collapsed
        );
      });
    } else if (element instanceof FileGroupTreeItem) {
      // Children of file group
      return element.changes.map(change => new FileChangeTreeItem(
        change,
        vscode.TreeItemCollapsibleState.None
      ));
    }

    return [];
  }

  private groupChangesByFile(changes: FileChange[]): Map<string, FileChange[]> {
    const grouped = new Map<string, FileChange[]>();

    for (const change of changes) {
      const existing = grouped.get(change.filePath) || [];
      existing.push(change);
      grouped.set(change.filePath, existing);
    }

    return grouped;
  }

  /**
   * Load changes for current workspace
   */
  async loadChanges(workspacePath: string, showPastSessions: boolean = false): Promise<void> {
    console.log('[ChangesTreeProvider] Loading changes for:', workspacePath);
    console.log('[ChangesTreeProvider] Show past sessions:', showPastSessions);

    this.showPastSessions = showPastSessions;

    if (showPastSessions) {
      // Load all sessions
      const sessionChanges = this.parser.getAllSessionChanges(workspacePath, 10);

      // Get current session ID
      const currentSessionFile = this.parser.getMostRecentSessionFile(workspacePath);
      const currentSessionId = currentSessionFile
        ? path.basename(currentSessionFile, '.jsonl')
        : null;

      console.log(`[ChangesTreeProvider] Loaded ${sessionChanges.size} sessions`);
      this.setSessionChanges(sessionChanges, currentSessionId);
    } else {
      // Load only current session
      let changes = this.parser.getCurrentSessionChanges(workspacePath);

      // Fallback to all changes if workspace not found
      if (changes.length === 0) {
        console.log('[ChangesTreeProvider] No changes for current workspace, loading all recent changes');
        changes = this.parser.getAllRecentChanges(100);
      }

      console.log(`[ChangesTreeProvider] Loaded ${changes.length} changes`);
      this.setChanges(changes);
    }
  }
}
