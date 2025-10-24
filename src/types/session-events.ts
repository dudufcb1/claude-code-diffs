/**
 * Types for Claude Code session events
 * Based on .jsonl session file structure
 */

export interface SessionEvent {
  parentUuid: string | null;
  isSidechain: boolean;
  userType: string;
  cwd: string;
  sessionId: string;
  version: string;
  gitBranch?: string;
  type: 'user' | 'assistant' | 'user_message' | 'file-history-snapshot';
  message?: Message;
  uuid: string;
  timestamp: string;
  thinkingMetadata?: ThinkingMetadata;
  toolUseResult?: any;
  snapshot?: FileHistorySnapshot;
}

export interface Message {
  id?: string;
  type?: string;
  role: 'user' | 'assistant';
  content: MessageContent[] | string;
  model?: string;
  stop_reason?: string | null;
  stop_sequence?: string | null;
  usage?: Usage;
}

export type MessageContent = TextContent | ToolUseContent | ToolResultContent;

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: ToolInput;
}

export interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

export interface ToolInput {
  file_path?: string;
  old_string?: string;
  new_string?: string;
  content?: string;
  replace_all?: boolean;
  command?: string;
  pattern?: string;
  [key: string]: any;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
}

export interface ThinkingMetadata {
  level: string;
  disabled: boolean;
  triggers: any[];
}

export interface FileHistorySnapshot {
  messageId: string;
  trackedFileBackups: Record<string, string>;
  timestamp: string;
}

/**
 * Parsed file change from session
 */
export interface FileChange {
  sessionId: string;
  timestamp: string;
  toolName: 'Edit' | 'Write' | 'Delete' | 'Heuristic';
  filePath: string;
  oldContent?: string;
  newContent?: string;
  gitBranch?: string;
  messageUuid: string;
  parentUuid: string | null;
  isDeleted?: boolean;
  isHeuristic?: boolean; // Flag for heuristically detected changes
}

/**
 * Session metadata
 */
export interface SessionMetadata {
  sessionId: string;
  workspacePath: string;
  startTime: string;
  endTime?: string;
  gitBranch?: string;
  totalChanges: number;
  filesModified: string[];
}
