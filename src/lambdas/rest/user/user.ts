import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as crypto from "crypto";

interface IntercomSecretConfig {
    secretKey: string;
}



export function installUserRest(router: cassava.Router): void {
    router.route("/v2/user/intercom")
        .method("GET")
        .serializers({
            "application/json": cassava.serializers.jsonSerializer
        })
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");

            const hmac = crypto.createHmac("sha256", "");
            hmac.update(auth.userId);

            return {
                body: hmac.digest("hex")
            };
        });
}