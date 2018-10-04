import * as crypto from "crypto";

let intercomSecrets: IntercomSecrets;

export async function initializeIntercomSecrets(secrets: Promise<IntercomSecrets>): Promise<void> {
    intercomSecrets = await secrets;
}

export function hashUserId(userId: string): string {
    if (!intercomSecrets) {
        throw "Intercom secrets have not been initialized.";
    }

   return crypto.createHmac("sha256", intercomSecrets.secretKey)
       .update(userId)
       .digest("hex");
}

export interface IntercomSecrets {
    secretKey: string;
}
