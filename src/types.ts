// Type definitions for the raw Composio tool objects we receive from
// `composio.tools.getRawComposioTools(...)`.
//
// These interfaces are derived strictly from the two sample tools we
// inspected (data/samples/sample_gmail_reply.json and
// data/samples/sample_github_issue_comment.json). Fields that appeared in
// only one sample are marked optional. No fields are invented.

export type JsonSchemaPrimitive = "string" | "integer" | "number" | "boolean";
export type JsonSchemaType = JsonSchemaPrimitive | "array" | "object";

// One entry inside `inputParameters.properties`. JSON-Schema-ish: most
// keywords match Draft-2020-12 but Composio adds custom flags (e.g.
// `file_uploadable`).
export interface InputParameter {
  type: JsonSchemaType;
  title: string;
  description?: string;
  default?: unknown;
  examples?: unknown[];

  // Present when `type === "array"`.
  items?: InputParameter;

  // Present when `type === "object"` (e.g. the gmail `attachment` field).
  properties?: Record<string, InputParameter>;
  required?: string[];
  additionalProperties?: boolean;

  // Composio-custom keyword observed on the gmail attachment object.
  file_uploadable?: boolean;
}

// The top-level `inputParameters` block.
export interface InputParameters {
  type: "object";
  properties: Record<string, InputParameter>;
  required?: string[];
  title: string;
  // GitHub sample includes a description here; gmail sample does not.
  description?: string;
}

// One entry inside `outputParameters.properties`. The `data` entry uses a
// `$ref` to a `#/$defs/...` name that is NOT actually defined anywhere on
// the tool object — so callers should treat the ref as a name-only label.
export interface OutputParameter {
  type?: JsonSchemaType;
  title: string;
  description?: string;
  $ref?: string;
}

// The top-level `outputParameters` block. In every observed tool this
// wraps the actual response under `{ data, error, successful }`.
export interface OutputParameters {
  type: "object";
  properties: {
    data: OutputParameter;
    error: OutputParameter;
    successful: OutputParameter;
  };
  required: string[];
  title: string;
}

export interface Toolkit {
  slug: string;
  name: string;
  logo: string;
}

// Free-form labels. Observed values include topical tags ("Comments",
// "important") and hint tags ("createHint", "openWorldHint").
export type Tag = string;

export interface Tool {
  slug: string;
  name: string;
  description: string;
  inputParameters: InputParameters;
  outputParameters: OutputParameters;
  tags: Tag[];
  toolkit: Toolkit;
  version: string;
  isDeprecated: boolean;
  availableVersions: string[];
  scopes: string[];
  isNoAuth: boolean;
}

// Dependency graph edges produced by src/extract.ts.

export type DependencyConfidence = "high" | "medium" | "low";
export type DependencyType = "hard" | "soft";

export interface DependencyEdge {
  from: string;           // producer tool slug
  to: string;             // consumer tool slug
  via: string;            // parameter name or token being passed
  confidence: DependencyConfidence;
  dependencyType: DependencyType;
  reason: string;         // one sentence explaining this edge
}
