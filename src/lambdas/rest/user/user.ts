import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {hashUserId} from "../../../utils/intercomUtils";

export function installUserRest(router: cassava.Router): void {
    router.route("/v2/user/intercom")
        .method("GET")
        .serializers({
            "application/json": cassava.serializers.jsonSerializer
        })
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId", "teamMemberId");

            console.log("userRest =>" + auth.teamMemberId);

            return {
                body: {
                    userHash: hashUserId(auth.teamMemberId),
                    userId: auth.teamMemberId
                }
            };
        });
}