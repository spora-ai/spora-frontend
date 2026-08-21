export type PrincipalType = 'user' | 'group'

export interface Principal {
    id: number
    type: PrincipalType
    name: string
    user_id?: number
    group_id?: number
}

export interface GroupMember {
    user_id: number
    name?: string
    email?: string
    role: 'owner' | 'admin' | 'member'
}

import type { ProfilePicture } from './profilePicture'

export interface Group {
    id: number
    name: string
    description: string | null
    principal_id: number
    member_count?: number
    members?: GroupMember[]
    /**
     * Caller's role within the group, emitted on the detail endpoint.
     * Optional because the list endpoint omits it; consumers must fall
     * back to membership lookup when absent.
     */
    my_role?: 'owner' | 'admin' | 'member'
    /**
     * Counts scoped to the group principal — emitted by
     * `GET /api/v1/groups/{id}`. Frontend renders the overview stat
     * cards from these.
     */
    agent_count?: number
    llm_config_count?: number
    tool_setting_count?: number
    /**
     * Resolved profile picture (archetype avatar or uploaded image) on
     * the `group_pictures` row. Mirrors `Agent.profile_picture` — the
     * dashboard's `Avatar` component renders both with no change.
     * Optional because the backend may omit it on the list endpoint;
     * consumers must fall back to the initial-letter Avatar when absent.
     */
    profile_picture?: ProfilePicture | null
}