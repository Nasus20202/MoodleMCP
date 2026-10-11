/** A tool argument flattened for display. */
export interface ToolArgument {
  name: string;
  type: string;
  description?: string;
  required: boolean;
  /** Shown when the argument is optional and has a default value. */
  default?: string;
}
