// Copy-pasted from https://github.com/Giftbit/internal-turnkey/blob/10d96c37edb23ee5335bb096d4aefd128097c6c1/src/utils/stripedtos/StripeAuth.ts

export interface StripeAuth {
    token_type: "bearer";
    stripe_publishable_key: string;
    scope: "read_write" | "read_only";
    livemode: boolean;
    stripe_user_id: string;
    refresh_token: string;
    access_token: string;
}
