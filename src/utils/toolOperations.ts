/**
 * Tool operation resolution.
 *
 * These functions mirror the PHP backend logic for resolving whether an
 * operation is enabled and whether it requires approval, given class-level
 * defaults and per-agent overrides.
 */

export interface ToolOperation {
  name: string
  description: string
  operator_description: string
  enabledByDefault: boolean
  requiresApprovalByDefault: boolean
  discriminatorKey: string
}

export interface OperationOverride {
  enabled: boolean | null       // null = use default
  default_requires_approval: boolean | null  // null = use default
}

export interface ResolvedOperation {
  enabled: boolean
  requiresApproval: boolean
}

/**
 * Resolve whether an operation is enabled for an agent.
 *
 * Precedence:
 *   1. agent_tool_operation_overrides.enabled (per-agent override)
 *   2. ToolOperation.enabledByDefault (class-level default)
 */
export function resolveOperationEnabled(
  operation: ToolOperation,
  override: OperationOverride | null,
): boolean {
  if (override && override.enabled !== null) {
    return override.enabled
  }
  return operation.enabledByDefault
}

/**
 * Resolve whether an operation requires approval.
 *
 * Precedence:
 *   1. agent_tool_operation_overrides.default_requires_approval (per-agent override)
 *   2. ToolOperation.requiresApprovalByDefault (class-level default)
 *
 * The override stores the inverse of requiresApproval — enabling auto-approve
 * stores `default_requires_approval: false`.
 */
export function resolveRequiresApproval(
  operation: ToolOperation,
  override: OperationOverride | null,
): boolean {
  if (override && override.default_requires_approval !== null) {
    return override.default_requires_approval
  }
  return operation.requiresApprovalByDefault
}

export function resolveOperation(
  operation: ToolOperation,
  override: OperationOverride | null,
): ResolvedOperation {
  return {
    enabled: resolveOperationEnabled(operation, override),
    requiresApproval: resolveRequiresApproval(operation, override),
  }
}
