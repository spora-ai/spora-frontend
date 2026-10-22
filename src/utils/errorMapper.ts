/**
 * HTTP status / API error code → { severity, action? } mapper.
 */

export type Severity = 'error' | 'warning' | 'success' | 'info'

export interface ErrorMapping {
  severity: Severity
  action?: string
}

export function mapHttpStatus(status: number, _errorCode?: string): ErrorMapping {
  if (status >= 200 && status < 300) {
    return { severity: 'success' }
  }

  if (status === 401) {
    return { severity: 'error', action: 'login' }
  }

  if (status === 403) {
    return { severity: 'error' }
  }

  if (status === 404) {
    return { severity: 'warning' }
  }

  if (status === 429) {
    return { severity: 'warning', action: 'retry' }
  }

  if (status >= 500) {
    return { severity: 'error' }
  }

  return { severity: 'warning' }
}

/**
 * Maps a structured API error code to a severity and a recommended action.
 */
export function mapErrorCode(code: string): ErrorMapping {
  switch (code) {
    case 'UNAUTHENTICATED':
    case 'ACCOUNT_UNVERIFIED':
    case 'ACCOUNT_SUSPENDED':
    case 'FORBIDDEN':
      return { severity: 'error', action: code === 'UNAUTHENTICATED' ? 'login' : undefined }

    case 'RATE_LIMIT':
    case 'TOO_MANY_REQUESTS':
      return { severity: 'warning', action: 'retry' }

    case 'LLM_RATE_LIMIT':
    case 'LLM_PROVIDER_ERROR':
      return { severity: 'warning', action: 'retry' }

    case 'DECRYPTION_FAILED':
      return { severity: 'error', action: 'contact' }

    case 'NOT_FOUND':
    case 'INVALID_STATE':
      return { severity: 'warning' }

    default:
      return { severity: 'warning' }
  }
}