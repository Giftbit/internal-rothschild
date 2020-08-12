export interface DbTag {
    userId: string;
    id: string;
    name: string | null;
    createdDate: Date;
    updatedDate: Date;
    createdBy: string;
}

export interface Tag {
    id?: string;
    name?: string;
}
