export interface Tag {
    userId: string;
    id: string;
    displayName: string | null;
    createdDate: Date;
    updatedDate: Date;
}

export interface TagOnResource {
    id?: string;
    displayName?: string;
}
