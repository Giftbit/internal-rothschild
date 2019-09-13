import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {hashIntercomUserId} from "../../../utils/intercomUtils";

export function installUserRest(router: cassava.Router): void {
    router.route("/v2/user/intercom")
        .method("GET")
        .serializers({
            "application/json": cassava.serializers.jsonSerializer
        })
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId", "teamMemberId");

            const teamMemberId = auth.teamMemberId.replace("-TEST", "");

            return {
                body: {
                    userHash: await hashIntercomUserId(teamMemberId),
                    teamMemberId
                }
            };
        });
}
