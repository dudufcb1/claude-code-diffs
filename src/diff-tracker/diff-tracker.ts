import * as vscode from 'vscode';
import * as fs from 'fs';
import { FileChange } from '../types/session-events';

/**
 * Tracks and displays file changes using VS Code diff API
 */
export class DiffTracker {
  private context: vscode.ExtensionContext;
  private changesCache: Map<string, FileChange[]> = new Map();
  private openDiffEditors: vscode.Uri[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * Show diff for a specific file change using VS Code's diff editor
   */
  async showDiff(change: FileChange, options?: { viewColumn?: vscode.ViewColumn; preview?: boolean }): Promise<void> {
    const filePath = change.filePath;

    // Handle deleted files specially
    if (change.isDeleted || change.toolName === 'Delete') {
      await this.showDeletedFile(change, options);
      return;
    }

    // Create temp files for before/after comparison
    const beforeUri = await this.createTempFile(
      change.oldContent || '',
      `before-${path.basename(filePath)}`
    );

    const afterUri = await this.createTempFile(
      change.newContent || '',
      `after-${path.basename(filePath)}`
    );

    // Format timestamp for title
    const timestamp = new Date(change.timestamp).toLocaleString();
    const title = `${path.basename(filePath)} - ${change.toolName} @ ${timestamp}`;

    // Determine view column
    const viewColumn = options?.viewColumn || this.getNextViewColumn();
    const preview = options?.preview !== undefined ? options.preview : false;

    // Open diff editor
    await vscode.commands.executeCommand(
      'vscode.diff',
      beforeUri,
      afterUri,
      title,
      { preview, viewColumn }
    );

    // Track open diff
    this.openDiffEditors.push(beforeUri);
    this.openDiffEditors.push(afterUri);
  }

  /**
   * Show deleted file information
   */
  async showDeletedFile(change: FileChange, options?: { viewColumn?: vscode.ViewColumn; preview?: boolean }): Promise<void> {
    const filePath = change.filePath;
    const timestamp = new Date(change.timestamp).toLocaleString();
    const fileName = path.basename(filePath);

    // Show information message with file name
    const action = await vscode.window.showInformationMessage(
      `File deleted: ${fileName} @ ${timestamp}`,
      'View Details'
    );

    if (action === 'View Details') {
      // Create temp file with deletion info
      const infoContent = [
        `File Deleted`,
        ``,
        `Path: ${filePath}`,
        `Timestamp: ${timestamp}`,
        `Session: ${change.sessionId}`,
        ``,
        `This file was deleted during the Claude Code session.`,
        ``,
        `To restore:`,
        `- Check git history: git log -- "${filePath}"`,
        `- Or restore from backup if available`
      ].join('\n');

      const infoUri = await this.createTempFile(
        infoContent,
        `deleted-${fileName}.txt`
      );

      const viewColumn = options?.viewColumn || vscode.ViewColumn.Two;

      await vscode.commands.executeCommand(
        'vscode.open',
        infoUri,
        { viewColumn, preview: false }
      );
    }
  }

  /**
   * Get the next available view column for opening diffs
   */
  private getNextViewColumn(): vscode.ViewColumn {
    const config = vscode.workspace.getConfiguration('claudeCodeDiff');
    const multipleDiffs = config.get<boolean>('liveMultipleDiffs', true);
    const maxOpenDiffs = config.get<number>('liveMaxOpenDiffs', 5);

    if (!multipleDiffs) {
      // Always use the same column (replaces previous diff)
      return vscode.ViewColumn.Two;
    }

    // Get currently visible text editors
    const visibleEditors = vscode.window.visibleTextEditors;
    const usedColumns = new Set(visibleEditors.map(e => e.viewColumn).filter(c => c !== undefined));

    // Find next available column
    let nextColumn = vscode.ViewColumn.Two;

    if (maxOpenDiffs > 0) {
      // Cycle through available columns up to max
      const columnsToTry = [
        vscode.ViewColumn.Two,
        vscode.ViewColumn.Three,
        vscode.ViewColumn.Four,
        vscode.ViewColumn.Five,
        vscode.ViewColumn.Six,
        vscode.ViewColumn.Seven,
        vscode.ViewColumn.Eight,
        vscode.ViewColumn.Nine
      ];

      // Find first unused column within limit
      for (let i = 0; i < Math.min(maxOpenDiffs, columnsToTry.length); i++) {
        if (!usedColumns.has(columnsToTry[i])) {
          return columnsToTry[i];
        }
      }

      // If all within limit are used, cycle back to column 2
      return vscode.ViewColumn.Two;
    }

    // Unlimited: find first unused column
    const columnsToTry = [
      vscode.ViewColumn.Two,
      vscode.ViewColumn.Three,
      vscode.ViewColumn.Four,
      vscode.ViewColumn.Five,
      vscode.ViewColumn.Six,
      vscode.ViewColumn.Seven,
      vscode.ViewColumn.Eight,
      vscode.ViewColumn.Nine
    ];

    for (const col of columnsToTry) {
      if (!usedColumns.has(col)) {
        return col;
      }
    }

    // All columns used, use Beside
    return vscode.ViewColumn.Beside;
  }

  /**
   * Close all open diff editors
   */
  async closeAllDiffs(): Promise<void> {
    console.log('[DiffTracker] Closing all open diffs');

    // Close tabs with temp files
    for (const uri of this.openDiffEditors) {
      const tabs = vscode.window.tabGroups.all
        .flatMap(group => group.tabs)
        .filter(tab => {
          if (tab.input instanceof vscode.TabInputTextDiff) {
            return tab.input.original.toString() === uri.toString() ||
                   tab.input.modified.toString() === uri.toString();
          }
          return false;
        });

      for (const tab of tabs) {
        await vscode.window.tabGroups.close(tab);
      }
    }

    this.openDiffEditors = [];
  }

  /**
   * Show diff for a file change compared to current file state
   */
  async showDiffWithCurrent(change: FileChange): Promise<void> {
    const filePath = change.filePath;

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      vscode.window.showWarningMessage(
        `File no longer exists: ${filePath}`
      );
      return;
    }

    // Read current file content
    const currentContent = fs.readFileSync(filePath, 'utf-8');

    // Get the content from the change
    let changeContent = '';
    if (change.toolName === 'Edit' && change.oldContent) {
      changeContent = change.oldContent;
    } else if (change.toolName === 'Write' && change.newContent) {
      changeContent = change.newContent;
    }

    // Create temp file for the change version
    const changeUri = await this.createTempFile(
      changeContent,
      `session-${path.basename(filePath)}`
    );

    // Current file URI
    const currentUri = vscode.Uri.file(filePath);

    // Format timestamp for title
    const timestamp = new Date(change.timestamp).toLocaleString();
    const title = `${path.basename(filePath)} - Session vs Current`;

    // Open diff editor
    await vscode.commands.executeCommand(
      'vscode.diff',
      changeUri,
      currentUri,
      title,
      { preview: true }
    );
  }

  /**
   * Create a temporary file in the extension's storage
   */
  private async createTempFile(
    content: string,
    filename: string
  ): Promise<vscode.Uri> {
    const tempDir = this.context.globalStorageUri;

    // Ensure temp directory exists
    try {
      await vscode.workspace.fs.createDirectory(tempDir);
    } catch (error) {
      // Directory might already exist
    }

    const tempFilePath = vscode.Uri.joinPath(tempDir, filename);

    // Write content to temp file
    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(
      tempFilePath,
      encoder.encode(content)
    );

    return tempFilePath;
  }

  /**
   * Show quick pick menu with all changes
   */
  async showChangesQuickPick(changes: FileChange[]): Promise<void> {
    if (changes.length === 0) {
      vscode.window.showInformationMessage(
        'No file changes found in current session'
      );
      return;
    }

    interface ChangeQuickPickItem extends vscode.QuickPickItem {
      change: FileChange;
    }

    // Create quick pick items
    const items: ChangeQuickPickItem[] = changes.map((change, index) => {
      const timestamp = new Date(change.timestamp);
      const timeStr = timestamp.toLocaleString();
      const fileName = path.basename(change.filePath);

      return {
        label: `$(file) ${fileName}`,
        description: `${change.toolName} @ ${timeStr}`,
        detail: change.filePath,
        change,
      };
    });

    // Show quick pick
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a file change to view diff',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (selected) {
      await this.showDiff(selected.change);
    }
  }

  /**
   * Group changes by file and show in tree view
   */
  groupChangesByFile(changes: FileChange[]): Map<string, FileChange[]> {
    const grouped = new Map<string, FileChange[]>();

    for (const change of changes) {
      const existing = grouped.get(change.filePath) || [];
      existing.push(change);
      grouped.set(change.filePath, existing);
    }

    return grouped;
  }

  /**
   * Show only deleted files in quick pick
   */
  async showDeletionsQuickPick(changes: FileChange[]): Promise<void> {
    // Filter only Delete operations
    const deletions = changes.filter(c => c.toolName === 'Delete' || c.isDeleted);

    if (deletions.length === 0) {
      vscode.window.showInformationMessage(
        'No file deletions found in current session'
      );
      return;
    }

    interface DeletionQuickPickItem extends vscode.QuickPickItem {
      change: FileChange;
    }

    // Create quick pick items for deletions
    const items: DeletionQuickPickItem[] = deletions.map((change) => {
      const timestamp = new Date(change.timestamp);
      const timeStr = timestamp.toLocaleString();
      const fileName = path.basename(change.filePath);

      return {
        label: `$(trash) ${fileName}`,
        description: `Deleted @ ${timeStr}`,
        detail: change.filePath,
        change,
      };
    });

    // Show quick pick
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Select a deleted file to view details (${deletions.length} deletions)`,
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (selected) {
      // Show deletion info
      await this.showDeletedFile(selected.change);
    }
  }
}

// Helper to get path module
import * as path from 'path';
