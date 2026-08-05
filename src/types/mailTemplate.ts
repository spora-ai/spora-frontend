export interface MailTemplate {
  id: number
  name: string
  subject: string
  body: string | null
  body_html: string | null
}

export interface CreateTemplatePayload {
  name: string
  subject: string
  body?: string | null
  body_html?: string | null
}

export interface UpdateTemplatePayload {
  name?: string
  subject?: string
  body?: string | null
  body_html?: string | null
}

export interface PreviewPayload {
  name: string
  subject: string
  body: string | null
  body_text: string | null
}
