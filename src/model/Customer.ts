export interface Customer {
    userId: string;
    customerId: string;
    createdDate: Date;
    updatedDate: Date;

    firstName: string | null;
    lastName: string | null;
    email: string | null;
}
