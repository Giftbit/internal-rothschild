import * as giftbitRoutes from "giftbit-cassava-routes";

export function getCreatedBy(auth: giftbitRoutes.jwtauth.AuthorizationBadge) {
    return auth.teamMemberId;
}