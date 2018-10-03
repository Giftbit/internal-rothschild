import * as testUtils from "../../../utils/testUtils";
import * as cassava from "cassava";
import * as chai from "chai";
import {installRestRoutes} from "../installRestRoutes";
import chaiExclude = require("chai-exclude");
import * as crypto from "crypto";
import {initializeIntercomSecrets} from "../../../utils/intercomUtils";

chai.use(chaiExclude);

describe.only("/v2/user", () => {

    const intercomTestSecret = "TEST_SECRET";
    const router = new cassava.Router();

    before(async () => {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await initializeIntercomSecrets(Promise.resolve({
            secretKey: intercomTestSecret
        }));
    });

    describe("/v2/user/intercom", () => {
        it("gets expected hash", async () => {
            const expectedOutput = crypto.createHmac("sha256", intercomTestSecret)
                .update(testUtils.defaultTestUser.teamMemberId)
                .digest("hex");

            const resp = await testUtils.testAuthedRequest<{userHash: string; userId: string; }>(router, "/v2/user/intercom", "GET");
            chai.assert.equal(resp.statusCode, 200);
            chai.assert.equal(expectedOutput, resp.body.userHash);
            chai.assert.equal(testUtils.defaultTestUser.teamMemberId, resp.body.userId);
        });
    });
});
