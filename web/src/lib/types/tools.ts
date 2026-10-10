// Tool catalog shapes (GET /api/tools).

export interface SchemaProperty {
  type?: string;
  description?: string;
}

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

/** A tool argument flattened for display. */
export interface ToolArgument {
  name: string;
  type: string;
  description?: string;
  required: boolean;
}
