import * as vscode from 'vscode';
import * as fs from 'fs';
import { FileChange } from '../types/session-events';

/**
 * Tracks and displays file changes using VS Code diff API
 */
export class DiffTracker {
  private context: vscode.ExtensionContext;
  private changesCache: Map<string, FileChange[]> = new Map();

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * Show diff for a specific file change using VS Code's diff editor
   */
  async showDiff(change: FileChange): Promise<void> {
    const filePath = change.filePath;

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

    // Open diff editor
    await vscode.commands.executeCommand(
      'vscode.diff',
      beforeUri,
      afterUri,
      title,
      { preview: true }
    );
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
   * Show changes summary in output channel
   */
  showChangesSummary(changes: FileChange[]): void {
    const channel = vscode.window.createOutputChannel('Claude Code Session Changes');
    channel.clear();
    channel.show();

    channel.appendLine('═══════════════════════════════════════════════════');
    channel.appendLine('  Claude Code Session Changes Summary');
    channel.appendLine('═══════════════════════════════════════════════════\n');

    const grouped = this.groupChangesByFile(changes);

    channel.appendLine(`Total files modified: ${grouped.size}`);
    channel.appendLine(`Total changes: ${changes.length}\n`);

    channel.appendLine('Changes by file:\n');

    for (const [filePath, fileChanges] of grouped) {
      channel.appendLine(`📄 ${filePath}`);
      channel.appendLine(`   ${fileChanges.length} change(s)\n`);

      for (const change of fileChanges) {
        const timestamp = new Date(change.timestamp).toLocaleString();
        channel.appendLine(`   • ${change.toolName} - ${timestamp}`);
      }

      channel.appendLine('');
    }

    channel.appendLine('═══════════════════════════════════════════════════');
  }
}

// Helper to get path module
import * as path from 'path';
