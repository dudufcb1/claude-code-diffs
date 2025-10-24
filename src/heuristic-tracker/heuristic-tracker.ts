import * as vscode from 'vscode';
import * as path from 'path';
import { DiffTracker } from '../diff-tracker/diff-tracker';
import { FileChange } from '../types/session-events';

/**
 * Heuristic file change tracker
 * Detects changes from ANY source (Claude, Qwen, other CLIs, manual edits, etc.)
 * Does NOT rely on .jsonl files - uses VS Code events instead
 */
export class HeuristicTracker {
  private fileSnapshots: Map<string, string> = new Map();
  private isEnabled: boolean = false;
  private delay: number = 500;
  private showNotifications: boolean = false;
  private pendingChanges: Map<string, NodeJS.Timeout> = new Map();
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private heuristicChanges: FileChange[] = []; // Store heuristic changes
  private onChangeCallback: (() => void) | null = null; // Callback when changes occur

  constructor(
    private diffTracker: DiffTracker,
    private context: vscode.ExtensionContext
  ) {}

  /**
   * Set callback to be called when changes are detected
   */
  setOnChangeCallback(callback: () => void): void {
    this.onChangeCallback = callback;
  }

  /**
   * Check if a file path should be excluded from tracking based on configuration patterns
   */
  private shouldExcludeFile(filePath: string): boolean {
    const config = vscode.workspace.getConfiguration('claudeCodeDiff');
    const excludePatterns = config.get<string[]>('heuristicExcludePatterns', []);

    // Normalize the file path to use forward slashes for consistent pattern matching
    const normalizedPath = filePath.replace(/\\/g, '/');

    for (const pattern of excludePatterns) {
      // Convert glob pattern to regex for matching
      // This is a simple implementation - for more complex patterns, could use minimatch library
      const regexPattern = pattern
        .replace(/\*\*/g, '.*')  // ** matches any number of directories
        .replace(/\*/g, '[^/]*')  // * matches anything except path separator
        .replace(/\?/g, '[^/]');  // ? matches single character except path separator

      const regex = new RegExp(regexPattern);

      if (regex.test(normalizedPath)) {
        console.log(`[HeuristicTracker] Excluding file: ${filePath} (matched pattern: ${pattern})`);
        return true;
      }
    }

    return false;
  }

  /**
   * Get all heuristically detected changes
   */
  getHeuristicChanges(): FileChange[] {
    return this.heuristicChanges;
  }

  /**
   * Enable or disable heuristic tracking
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    console.log(`[HeuristicTracker] Heuristic tracking ${enabled ? 'enabled' : 'disabled'}`);

    if (enabled) {
      // Take initial snapshots of all open editors
      this.captureInitialSnapshots();

      // Create file watcher for new files
      this.createFileWatcher();

      vscode.window.showInformationMessage('Heuristic file tracking enabled');
    } else {
      // Clear all snapshots and pending changes
      this.fileSnapshots.clear();
      for (const timeout of this.pendingChanges.values()) {
        clearTimeout(timeout);
      }
      this.pendingChanges.clear();

      // Dispose file watcher
      if (this.fileWatcher) {
        this.fileWatcher.dispose();
        this.fileWatcher = null;
      }
    }
  }

  /**
   * Set delay before capturing changes
   */
  setDelay(delay: number): void {
    this.delay = delay;
    console.log(`[HeuristicTracker] Delay set to ${delay}ms`);
  }

  /**
   * Set notification preference
   */
  setShowNotifications(show: boolean): void {
    this.showNotifications = show;
  }

  /**
   * Capture initial snapshots of currently open editors
   */
  private captureInitialSnapshots(): void {
    console.log('[HeuristicTracker] Capturing initial snapshots');

    for (const editor of vscode.window.visibleTextEditors) {
      const doc = editor.document;

      // Skip non-file schemes
      if (doc.uri.scheme !== 'file') {
        continue;
      }

      // Check if file should be excluded
      if (this.shouldExcludeFile(doc.fileName)) {
        continue;
      }

      const uri = doc.uri.toString();
      const content = doc.getText();
      this.fileSnapshots.set(uri, content);
      console.log(`[HeuristicTracker] Snapshot: ${uri} (${content.length} chars)`);
    }
  }

  /**
   * Create file watcher to detect new files created in workspace
   */
  private createFileWatcher(): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      console.log('[HeuristicTracker] No workspace folder, skipping file watcher');
      return;
    }

    // Watch all common file types
    const pattern = new vscode.RelativePattern(
      workspaceFolders[0],
      '**/*.{js,ts,jsx,tsx,py,java,go,rs,c,cpp,h,hpp,php,rb,swift,kt,cs,vue,html,css,scss,json,yaml,yml,md,txt}'
    );

    this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    // Handle file creation
    this.fileWatcher.onDidCreate(async (uri) => {
      if (!this.isEnabled) {
        return;
      }

      // Check if file should be excluded
      if (this.shouldExcludeFile(uri.fsPath)) {
        return;
      }

      console.log(`[HeuristicTracker] File created: ${uri.fsPath}`);

      // Wait a bit to ensure file is written
      setTimeout(async () => {
        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          const content = doc.getText();

          if (content.length > 0) {
            console.log(`[HeuristicTracker] New file with content: ${uri.fsPath} (${content.length} chars)`);

            // Store snapshot
            this.fileSnapshots.set(uri.toString(), content);

            // Show diff
            await this.showHeuristicDiff(
              uri.fsPath,
              '', // Empty before
              content, // New content
              doc.languageId
            );

            if (this.showNotifications) {
              const fileName = uri.fsPath.split(/[/\\]/).pop();
              vscode.window.showInformationMessage(
                `[Heuristic] New file: ${fileName}`
              );
            }
          }
        } catch (error) {
          console.error('[HeuristicTracker] Error processing new file:', error);
        }
      }, this.delay);
    });

    // Also handle file changes (for external CLIs that modify files)
    this.fileWatcher.onDidChange(async (uri) => {
      if (!this.isEnabled) {
        return;
      }

      // Check if file should be excluded
      if (this.shouldExcludeFile(uri.fsPath)) {
        return;
      }

      console.log(`[HeuristicTracker] File changed (external): ${uri.fsPath}`);

      const uriString = uri.toString();

      // Check if we have a snapshot AND if this looks like a real user file change
      if (!this.fileSnapshots.has(uriString)) {
        console.log(`[HeuristicTracker] File change detected (not in snapshots): ${uri.fsPath}`);

        // RESTRICTIVE: Only track files in workspace root or immediate subdirectories
        // Skip files in deep nested library paths
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          const workspaceRoot = workspaceFolders[0].uri.fsPath;
          const relativePath = path.relative(workspaceRoot, uri.fsPath);
          const pathDepth = relativePath.split(path.sep).length;

          // Skip files more than 3 levels deep (likely libraries)
          if (pathDepth > 3) {
            console.log(`[HeuristicTracker] Skipping deep file (depth ${pathDepth}): ${relativePath}`);
            return;
          }
        }

        setTimeout(async () => {
          try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const content = doc.getText();

            if (content.length > 0 && content.length < 10000) { // Also skip very large files
              // Store snapshot
              this.fileSnapshots.set(uriString, content);

              // Store change (no tab opening)
              await this.showHeuristicDiff(
                uri.fsPath,
                '', // Empty before
                content, // New content
                doc.languageId
              );

              if (this.showNotifications) {
                const fileName = uri.fsPath.split(/[/\\]/).pop();
                vscode.window.showInformationMessage(
                  `[Heuristic] New file: ${fileName}`
                );
              }
            } else {
              console.log(`[HeuristicTracker] Skipping file (too large or empty): ${uri.fsPath} (${content.length} chars)`);
            }
          } catch (error) {
            console.error('[HeuristicTracker] Error processing changed file:', error);
          }
        }, this.delay);
      }
    });

    console.log('[HeuristicTracker] File watcher created');
  }

  /**
   * Handle text document changes (before save)
   */
  async onWillSaveTextDocument(event: vscode.TextDocumentWillSaveEvent): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    const doc = event.document;
    const uri = doc.uri.toString();

    // Skip if it's not a file scheme (e.g., untitled, git, etc.)
    if (doc.uri.scheme !== 'file') {
      return;
    }

    // Check if file should be excluded
    if (this.shouldExcludeFile(doc.fileName)) {
      return;
    }

    console.log(`[HeuristicTracker] Will save: ${uri}`);

    // Get the current content (before save)
    const originalContent = this.fileSnapshots.get(uri) || '';
    const currentContent = doc.getText();

    // Cancel any pending change for this file
    if (this.pendingChanges.has(uri)) {
      clearTimeout(this.pendingChanges.get(uri)!);
    }

    // Schedule diff display after delay
    const timeout = setTimeout(async () => {
      try {
        // Get the saved version (after save)
        const savedDoc = await vscode.workspace.openTextDocument(doc.uri);
        const savedContent = savedDoc.getText();

        // Only show diff if there was an actual change
        if (originalContent !== savedContent) {
          console.log(`[HeuristicTracker] Change detected in: ${doc.fileName}`);

          await this.showHeuristicDiff(
            doc.fileName,
            originalContent,
            savedContent,
            doc.languageId
          );

          // Update snapshot with new content
          this.fileSnapshots.set(uri, savedContent);

          if (this.showNotifications) {
            vscode.window.showInformationMessage(
              `[Heuristic] ${doc.fileName.split(/[/\\]/).pop()}`
            );
          }
        } else {
          console.log(`[HeuristicTracker] No changes detected in: ${doc.fileName}`);
        }
      } catch (error) {
        console.error('[HeuristicTracker] Error processing change:', error);
      } finally {
        this.pendingChanges.delete(uri);
      }
    }, this.delay);

    this.pendingChanges.set(uri, timeout);
  }

  /**
   * Handle text document open
   */
  onDidOpenTextDocument(doc: vscode.TextDocument): void {
    if (!this.isEnabled) {
      return;
    }

    if (doc.uri.scheme !== 'file') {
      return;
    }

    // Check if file should be excluded
    if (this.shouldExcludeFile(doc.fileName)) {
      return;
    }

    const uri = doc.uri.toString();
    const content = doc.getText();

    // Check if this is a new file (not in snapshots)
    const isNotInSnapshots = !this.fileSnapshots.has(uri);

    // Store initial snapshot
    this.fileSnapshots.set(uri, content);

    // RESTRICTIVE: Only track files that are TRULY new (untitled) and being actively edited
    // Do NOT track files just because they're opened for the first time in this session
    if (isNotInSnapshots && content.length > 0 && doc.isUntitled) {
      // This is a truly new untitled file with content
      console.log(`[HeuristicTracker] New untitled file detected: ${uri} (${content.length} chars)`);

      // Store change but DO NOT open tab (handled in showHeuristicDiff now)
      setTimeout(async () => {
        await this.showHeuristicDiff(
          doc.fileName,
          '', // Empty content before
          content, // New content
          doc.languageId
        );

        if (this.showNotifications) {
          vscode.window.showInformationMessage(
            `[Heuristic] New file: ${doc.fileName.split(/[/\\]/).pop()}`
          );
        }
      }, this.delay);
    } else {
      // Just store snapshot for potential future changes, but don't treat as "new"
      console.log(`[HeuristicTracker] Document opened: ${uri} (${content.length} chars) - stored snapshot only`);
    }
  }

  /**
   * Handle text document close
   */
  onDidCloseTextDocument(doc: vscode.TextDocument): void {
    if (!this.isEnabled) {
      return;
    }

    const uri = doc.uri.toString();

    // Remove snapshot
    this.fileSnapshots.delete(uri);

    // Cancel pending changes
    if (this.pendingChanges.has(uri)) {
      clearTimeout(this.pendingChanges.get(uri)!);
      this.pendingChanges.delete(uri);
    }

    console.log(`[HeuristicTracker] Document closed: ${uri}`);
  }

  /**
   * Store heuristically detected change (NO TABS - only for tree view)
   */
  private async showHeuristicDiff(
    fileName: string,
    beforeContent: string,
    afterContent: string,
    languageId: string
  ): Promise<void> {
    try {
      // Create FileChange object
      const change: FileChange = {
        sessionId: 'heuristic',
        timestamp: new Date().toISOString(),
        toolName: 'Heuristic',
        filePath: fileName,
        oldContent: beforeContent,
        newContent: afterContent,
        messageUuid: `heuristic-${Date.now()}`,
        parentUuid: null,
        isHeuristic: true
      };

      // Store the change (for tree view only)
      this.heuristicChanges.push(change);
      console.log(`[HeuristicTracker] Stored heuristic change: ${fileName} (total: ${this.heuristicChanges.length}) - NO TAB OPENED`);

      // Notify tree view
      if (this.onChangeCallback) {
        this.onChangeCallback();
      }

      // REMOVED: No longer opening tabs automatically for heuristic changes
      // Users can manually open diffs from the tree view if they want to see them
    } catch (error) {
      console.error('[HeuristicTracker] Error storing heuristic change:', error);
    }
  }

  /**
   * Create temporary file for diff
   */
  private async createTempFile(
    content: string,
    filename: string,
    languageId: string
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
   * Get base name from file path
   */
  private getBaseName(filePath: string): string {
    return filePath.split(/[/\\]/).pop() || filePath;
  }

  /**
   * Get next available view column for opening diffs
   */
  private getNextViewColumn(): vscode.ViewColumn {
    const config = vscode.workspace.getConfiguration('claudeCodeDiff');
    const maxOpenDiffs = config.get<number>('liveMaxOpenDiffs', 5);

    // Get currently visible text editors
    const visibleEditors = vscode.window.visibleTextEditors;
    const usedColumns = new Set(visibleEditors.map(e => e.viewColumn).filter(c => c !== undefined));

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
   * Reset tracker state
   */
  reset(): void {
    console.log('[HeuristicTracker] Resetting state');
    this.fileSnapshots.clear();

    // Cancel pending changes
    for (const timeout of this.pendingChanges.values()) {
      clearTimeout(timeout);
    }
    this.pendingChanges.clear();
  }

  /**
   * Cleanup
   */
  dispose(): void {
    this.reset();
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
      this.fileWatcher = null;
    }
  }
}
