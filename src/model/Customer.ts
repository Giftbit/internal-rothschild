export interface Customer {
    customerId: string;
    userId: string;
    createdDate: Date;
    updatedDate: Date;

    firstName: string | null;
    lastName: string | null;
    email: string | null;
}
