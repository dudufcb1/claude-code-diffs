import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { SessionEvent, FileChange, SessionMetadata } from '../types/session-events';

/**
 * Parser for Claude Code .jsonl session files
 * Based on the structure from claude_sessions.py
 */
export class SessionParser {
  private homeDir: string;
  private defaultClaudeInstances: string[];

  constructor() {
    this.homeDir = os.homedir();
    // Search .claude first (official), then alternatives
    this.defaultClaudeInstances = ['.claude', '.claude-gpt5'];
    console.log('[SessionParser] Initialized with home:', this.homeDir);
  }

  /**
   * Get Claude instance paths from config or defaults
   */
  private getClaudeInstancePaths(): string[] {
    const config = vscode.workspace.getConfiguration('claudeCodeDiff');
    const customPaths = config.get<string[]>('claudeInstancePaths', []);

    // If custom paths configured, use them
    if (customPaths.length > 0) {
      console.log('[SessionParser] Using custom Claude instance paths:', customPaths);
      return customPaths;
    }

    // Otherwise, auto-detect from home directory
    return this.defaultClaudeInstances.map(instance =>
      path.join(this.homeDir, instance)
    );
  }

  /**
   * Find all Claude instance directories
   */
  findClaudeInstances(): string[] {
    const instances: string[] = [];
    const instancePaths = this.getClaudeInstancePaths();

    for (const instancePath of instancePaths) {
      const projectsPath = path.join(instancePath, 'projects');
      if (fs.existsSync(projectsPath)) {
        instances.push(instancePath);
      }
    }

    console.log('[SessionParser] Found Claude instances:', instances);
    return instances;
  }

  /**
   * Encode workspace path for Claude directory name
   * Works cross-platform: handles / (Linux/Mac) and \ (Windows)
   * Example (Linux): /home/eduardo/project -> -home-eduardo-project
   * Example (Windows): C:\Users\Name\project -> C--Users-Name-project
   */
  private encodeWorkspacePath(workspacePath: string): string {
    // Normalize path separators to forward slash
    let normalized = workspacePath.replace(/\\/g, '/');

    // Replace all / with -
    // On Windows: C:/Users/Name/project -> C:-Users-Name-project
    // On Linux: /home/eduardo/project -> -home-eduardo-project
    let encoded = normalized.replace(/\//g, '-');

    // On Windows, replace : from drive letter with -
    // C:-Users-Name-project -> C--Users-Name-project
    encoded = encoded.replace(/:/g, '-');

    return encoded;
  }

  /**
   * Get workspace path from encoded directory name
   * Example: -home-eduardo-copilot-api-codex -> /home/eduardo/copilot-api-codex
   */
  decodeWorkspaceName(encodedName: string): string {
    return encodedName.replace(/-/g, '/');
  }

  /**
   * Get the current workspace session directory
   */
  getCurrentWorkspaceSessionDir(workspacePath: string): string | null {
    console.log('[SessionParser] Looking for workspace:', workspacePath);

    const instances = this.findClaudeInstances();
    console.log('[SessionParser] Found Claude instances:', instances);

    // Encode workspace path (cross-platform)
    const encodedName = this.encodeWorkspacePath(workspacePath);
    console.log('[SessionParser] Encoded name:', encodedName);

    for (const instancePath of instances) {
      const projectsDir = path.join(instancePath, 'projects');
      const workspaceDir = path.join(projectsDir, encodedName);

      console.log('[SessionParser] Checking:', workspaceDir);

      if (fs.existsSync(workspaceDir)) {
        console.log('[SessionParser] ✓ Found workspace dir:', workspaceDir);
        return workspaceDir;
      }
    }

    console.log('[SessionParser] ✗ Workspace directory not found');
    console.log('[SessionParser] Available workspaces:');

    // List all available workspaces for debugging
    for (const instancePath of instances) {
      const projectsDir = path.join(instancePath, 'projects');
      if (fs.existsSync(projectsDir)) {
        const dirs = fs.readdirSync(projectsDir);
        console.log(`  ${instancePath}:`, dirs.slice(0, 5).join(', '));
      }
    }

    return null;
  }

  /**
   * Get all session files for a workspace
   */
  getSessionFiles(workspaceDir: string): string[] {
    console.log('[SessionParser] Getting session files from:', workspaceDir);

    if (!fs.existsSync(workspaceDir)) {
      console.log('[SessionParser] ✗ Directory does not exist');
      return [];
    }

    const files = fs.readdirSync(workspaceDir)
      .filter(file => file.endsWith('.jsonl'))
      .map(file => path.join(workspaceDir, file))
      .sort((a, b) => {
        const statA = fs.statSync(a);
        const statB = fs.statSync(b);
        return statB.mtimeMs - statA.mtimeMs; // Most recent first
      });

    console.log(`[SessionParser] Found ${files.length} session files`);
    if (files.length > 0) {
      console.log('[SessionParser] Most recent:', path.basename(files[0]));
    }

    return files;
  }

  /**
   * Get the most recent session file for current workspace
   */
  getMostRecentSessionFile(workspacePath: string): string | null {
    const workspaceDir = this.getCurrentWorkspaceSessionDir(workspacePath);
    if (!workspaceDir) {
      return null;
    }

    const sessionFiles = this.getSessionFiles(workspaceDir);
    return sessionFiles.length > 0 ? sessionFiles[0] : null;
  }

  /**
   * Parse a single line from .jsonl file
   */
  private parseLine(line: string): SessionEvent | null {
    try {
      return JSON.parse(line);
    } catch (error) {
      console.error('Failed to parse line:', error);
      return null;
    }
  }

  /**
   * Extract file changes from session events
   */
  extractFileChanges(events: SessionEvent[]): FileChange[] {
    console.log(`[SessionParser] Extracting changes from ${events.length} events`);
    const changes: FileChange[] = [];

    for (const event of events) {
      // Skip non-assistant messages
      if (event.type !== 'assistant' || !event.message?.content) {
        continue;
      }

      const content = Array.isArray(event.message.content)
        ? event.message.content
        : [];

      for (const item of content) {
        if (item.type !== 'tool_use') {
          continue;
        }

        const toolName = item.name;
        const input = item.input;

        // Process Edit and Write tools
        if (toolName === 'Edit' || toolName === 'Write') {
          if (!input.file_path) {
            console.log(`[SessionParser] Skipping ${toolName} - no file_path`);
            continue;
          }

          console.log(`[SessionParser] Found ${toolName}: ${input.file_path}`);

          const change: FileChange = {
            sessionId: event.sessionId,
            timestamp: event.timestamp,
            toolName: toolName as 'Edit' | 'Write',
            filePath: input.file_path,
            gitBranch: event.gitBranch,
            messageUuid: event.uuid,
            parentUuid: event.parentUuid,
          };

          if (toolName === 'Edit') {
            change.oldContent = input.old_string;
            change.newContent = input.new_string;
          } else if (toolName === 'Write') {
            change.newContent = input.content;
          }

          changes.push(change);
        }
        // Process Bash commands that delete files
        else if (toolName === 'Bash') {
          const command = input.command || '';

          // Detect rm commands
          const rmMatch = command.match(/\brm\s+(?:-[rf]+\s+)?(.+)/);
          if (rmMatch) {
            const filePaths = rmMatch[1]
              .split(/\s+/)
              .filter(p => p && !p.startsWith('-'));

            for (const filePath of filePaths) {
              // Clean up the file path
              const cleanPath = filePath.trim().replace(/['"]/g, '');

              if (cleanPath) {
                console.log(`[SessionParser] Found Delete (via Bash rm): ${cleanPath}`);

                const change: FileChange = {
                  sessionId: event.sessionId,
                  timestamp: event.timestamp,
                  toolName: 'Delete',
                  filePath: cleanPath,
                  gitBranch: event.gitBranch,
                  messageUuid: event.uuid,
                  parentUuid: event.parentUuid,
                  isDeleted: true,
                };

                changes.push(change);
              }
            }
          }
        }
      }
    }

    console.log(`[SessionParser] Extracted ${changes.length} file changes`);
    return changes;
  }

  /**
   * Parse entire session file and extract all events
   */
  parseSessionFile(sessionFilePath: string): SessionEvent[] {
    const events: SessionEvent[] = [];

    if (!fs.existsSync(sessionFilePath)) {
      return events;
    }

    const content = fs.readFileSync(sessionFilePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const event = this.parseLine(line);
      if (event) {
        events.push(event);
      }
    }

    return events;
  }

  /**
   * Get session metadata from events
   */
  getSessionMetadata(events: SessionEvent[]): SessionMetadata | null {
    if (events.length === 0) {
      return null;
    }

    const firstEvent = events[0];
    const lastEvent = events[events.length - 1];

    const changes = this.extractFileChanges(events);
    const filesModified = [...new Set(changes.map(c => c.filePath))];

    return {
      sessionId: firstEvent.sessionId,
      workspacePath: firstEvent.cwd,
      startTime: firstEvent.timestamp,
      endTime: lastEvent.timestamp,
      gitBranch: firstEvent.gitBranch,
      totalChanges: changes.length,
      filesModified,
    };
  }

  /**
   * Get all changes from the most recent session
   */
  getCurrentSessionChanges(workspacePath: string): FileChange[] {
    console.log('[SessionParser] Getting current session changes for:', workspacePath);

    const sessionFile = this.getMostRecentSessionFile(workspacePath);

    if (!sessionFile) {
      console.log('[SessionParser] ✗ No session file found');
      return [];
    }

    console.log('[SessionParser] ✓ Using session file:', sessionFile);

    const events = this.parseSessionFile(sessionFile);
    return this.extractFileChanges(events);
  }

  /**
   * Get changes from all sessions for a workspace
   * Returns a map of sessionId -> changes
   */
  getAllSessionChanges(workspacePath: string, limit: number = 10): Map<string, { sessionFile: string; changes: FileChange[] }> {
    console.log('[SessionParser] Getting all session changes for:', workspacePath);

    const workspaceDir = this.getCurrentWorkspaceSessionDir(workspacePath);
    if (!workspaceDir) {
      console.log('[SessionParser] ✗ No workspace directory found');
      return new Map();
    }

    const sessionFiles = this.getSessionFiles(workspaceDir);
    console.log(`[SessionParser] Found ${sessionFiles.length} session files`);

    const sessionChanges = new Map<string, { sessionFile: string; changes: FileChange[] }>();

    // Process up to 'limit' most recent sessions
    for (let i = 0; i < Math.min(sessionFiles.length, limit); i++) {
      const sessionFile = sessionFiles[i];
      const events = this.parseSessionFile(sessionFile);
      const changes = this.extractFileChanges(events);

      if (changes.length > 0) {
        const sessionId = path.basename(sessionFile, '.jsonl');
        sessionChanges.set(sessionId, {
          sessionFile,
          changes
        });
      }
    }

    console.log(`[SessionParser] Found changes in ${sessionChanges.size} sessions`);
    return sessionChanges;
  }

  /**
   * Get recent changes (last N changes)
   */
  getRecentChanges(workspacePath: string, limit: number = 50): FileChange[] {
    const changes = this.getCurrentSessionChanges(workspacePath);
    return changes.slice(0, limit);
  }

  /**
   * Get changes from ALL recent sessions (any workspace)
   * Useful when workspace directory doesn't exist yet
   */
  getAllRecentChanges(limit: number = 50): FileChange[] {
    console.log('[SessionParser] Getting ALL recent changes from all workspaces');
    const allChanges: FileChange[] = [];

    const instances = this.findClaudeInstances();

    for (const instancePath of instances) {
      const projectsDir = path.join(instancePath, 'projects');

      if (!fs.existsSync(projectsDir)) {
        continue;
      }

      // Get all workspace directories
      const workspaceDirs = fs.readdirSync(projectsDir)
        .map(name => path.join(projectsDir, name))
        .filter(dir => fs.statSync(dir).isDirectory());

      console.log(`[SessionParser] Checking ${workspaceDirs.length} workspaces in ${instancePath}`);

      for (const workspaceDir of workspaceDirs) {
        const sessionFiles = this.getSessionFiles(workspaceDir);

        // Only check the most recent session per workspace
        if (sessionFiles.length > 0) {
          const mostRecent = sessionFiles[0];
          const events = this.parseSessionFile(mostRecent);
          const changes = this.extractFileChanges(events);
          allChanges.push(...changes);
        }
      }
    }

    // Sort by timestamp (most recent first)
    allChanges.sort((a, b) => {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    console.log(`[SessionParser] Found ${allChanges.length} total changes across all workspaces`);

    return allChanges.slice(0, limit);
  }
}
