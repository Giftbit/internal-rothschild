export interface Tag {
    userId: string;
    id: string;
    name: string | null;
    createdDate: Date;
    updatedDate: Date;
}

export interface TagOnResource {
    id?: string;
    name?: string;
}
