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

export interface Group {
    id: number
    name: string
    description: string | null
    principal_id: number
    members: GroupMember[]
}