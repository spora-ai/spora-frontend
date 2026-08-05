/**
 * useMailTemplates — pure helpers for the admin MailTemplatesPage.
 *
 * Owns the system-template list, the placeholder registry + chip formatter,
 * and the create/save payload builders. The SFC keeps the template,
 * visibility toggles, and store calls.
 */

export const MAIL_TEMPLATE_SYSTEM_NAMES = [
  'email_verification',
  'password_reset',
  'welcome',
] as const

export const MAIL_TEMPLATE_PLACEHOLDERS = [
  'user_name',
  'email',
  'verification_link',
  'reset_link',
  'site_name',
] as const

/** Whether a template is one of the protected system templates. */
export function isSystemTemplate(name: string | null | undefined): boolean {
  if (!name) return false
  return (MAIL_TEMPLATE_SYSTEM_NAMES as readonly string[]).includes(name)
}

/** Wrap a placeholder name in `{{...}}` for display. */
export function formatPlaceholder(ph: string): string {
  return `{{${ph}}}`
}

/** Insert a placeholder into both the Markdown and HTML body fields. */
export function insertPlaceholderInto(
  body: string,
  bodyHtml: string,
  ph: string,
): { body: string; body_html: string } {
  return {
    body: body + `{{${ph}}}`,
    body_html: bodyHtml + `{{${ph}}}`,
  }
}

export interface MailTemplateDraft {
  name: string
  subject: string
  body: string
  body_html: string
}

/** Build the body sent to PUT /admin/mail-templates/{id}. */
export function buildUpdatePayload(draft: MailTemplateDraft): {
  subject: string
  body: string | null
  body_html: string | null
} {
  return {
    subject: draft.subject,
    body: draft.body || null,
    body_html: draft.body_html || null,
  }
}

export interface MailTemplateCreateDraft {
  name: string
  subject: string
  body: string
  body_html: string
}

/** Build the body sent to POST /admin/mail-templates. */
export function buildCreatePayload(draft: MailTemplateCreateDraft): {
  name: string
  subject: string
  body: string | null
  body_html: string | null
} {
  return {
    name: draft.name.trim(),
    subject: draft.subject.trim(),
    body: draft.body || null,
    body_html: draft.body_html || null,
  }
}

/** Validate the "create template" form. Returns an error string or null. */
export function validateCreateTemplate(draft: MailTemplateCreateDraft): string | null {
  if (!draft.name.trim()) return 'Name is required.'
  if (!draft.subject.trim()) return 'Subject is required.'
  return null
}

/** Seed a fresh empty editor form (used after a save or modal reset). */
export function emptyCreateDraft(): MailTemplateCreateDraft {
  return { name: '', subject: '', body: '', body_html: '' }
}
