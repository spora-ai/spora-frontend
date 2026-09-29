/**
 * Re-export of the package's `useInitials`. Takes a raw name string
 * (not a `User`) and falls back to `'?'`; callers wanting an email
 * fallback resolve name-or-email first. No production call site left.
 */
export { useInitials } from '@spora-ai/components/composables'
