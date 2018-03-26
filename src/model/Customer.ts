export interface Customer {
    customerId: string;
    userId: string;

    firstName: string | null;
    lastName: string | null;
    email: string | null;

    createdDate: Date;
    updatedDate: Date;
}
