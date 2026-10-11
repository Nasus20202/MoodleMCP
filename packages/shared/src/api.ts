// Request and response bodies of the HTTP API used by the web UI.

export interface ConfigResponse {
  /** The server's default Moodle site. */
  moodleUrl: string;
  /** Whether the server offers OAuth sign-in, so clients need no header. */
  oauth: boolean;
}

export interface SchemaProperty {
  type?: string;
  description?: string;
  default?: unknown;
}

/** The subset of JSON Schema the UI renders. */
export interface InputSchema {
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

export interface ToolInfo {
  name: string;
  description: string;
  readOnly: boolean;
  inputSchema: InputSchema;
}

export interface ToolsResponse {
  tools: ToolInfo[];
}

export interface ExchangeRequest {
  /** Decoded text of a Moodle app QR code. */
  qr: string;
}

export interface ExchangeResponse {
  token: string;
}

export interface ErrorResponse {
  error: string;
}
