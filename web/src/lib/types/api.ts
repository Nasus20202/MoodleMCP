// Request and response bodies of the backend API; mirrors internal/server/types.go.

import type { ToolInfo } from './tools';

export interface ConfigResponse {
  moodleUrl: string;
}

export interface ToolsResponse {
  tools: ToolInfo[];
}

export interface ExchangeRequest {
  qr: string;
}

export interface ExchangeResponse {
  token: string;
}

export interface ErrorResponse {
  error: string;
}
