export interface Contact { // todo - Customer or Contact? A customer seems to imply they've purchased something.
    id: string;
    merchantId: string;
    email: string;
    firstName: string;
    lastName: string;
    birthday: Date; // todo - probably exclude. It was surprising how many competitors leveraged things like birthday promotions
}