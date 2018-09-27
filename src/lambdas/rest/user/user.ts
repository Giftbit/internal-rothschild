import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as crypto from "crypto";
import {getIntercomSecret} from "../../../utils/codeCryptoUtils";

export function installUserRest(router: cassava.Router): void {
    router.route("/v2/user/intercom")
        .method("GET")
        .serializers({
            "application/json": cassava.serializers.jsonSerializer
        })
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2");

            const hmac = crypto.createHmac("sha256", getIntercomSecret());
            hmac.update(auth.userId);

            return {
                body: hmac.digest("hex")
            };
        });
}