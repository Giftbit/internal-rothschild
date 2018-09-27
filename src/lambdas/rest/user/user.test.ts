import * as testUtils from "../../../utils/testUtils";
import * as cassava from "cassava";
import * as chai from "chai";
import {installRestRoutes} from "../installRestRoutes";
import {createCurrency} from "../currencies";
import chaiExclude = require("chai-exclude");
import {setCodeCryptographySecrets} from "../../../utils/testUtils";
import * as crypto from "crypto";
import {getIntercomSecret} from "../../../utils/codeCryptoUtils";

chai.use(chaiExclude);

describe("/v2/user", () => {

    const router = new cassava.Router();

    before(async () => {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await setCodeCryptographySecrets();
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "USDees",
            symbol: "$",
            decimalPlaces: 2
        });
    });

    describe("/v2/user/intercom", () => {
        it("gets expected hash", async () => {
            const hmac = crypto.createHmac("sha256", getIntercomSecret());
            hmac.update(testUtils.defaultTestUser.userId);
            const expectedOutput = hmac.digest("hex");

            const resp = await testUtils.testAuthedRequest(router, "/v2/user/intercom", "GET");
            chai.assert.equal(resp.statusCode, 200);
            chai.assert.deepEqual(resp.body, []);
            chai.assert.equal(expectedOutput, resp.body);
        });
    });
});
