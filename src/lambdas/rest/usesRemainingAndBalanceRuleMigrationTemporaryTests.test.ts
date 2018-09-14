import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../utils/testUtils";
import {setCodeCryptographySecrets} from "../../utils/testUtils";
import {installRestRoutes} from "./installRestRoutes";
import {createCurrency} from "./currencies";
import {Program} from "../../model/Program";
import {Issuance} from "../../model/Issuance";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

/**
 * This is a temporary test. It can be deleted once valueRule, uses,
 * and fixedInitialUsesRemaining have been removed from the API.
 */
describe("/v2/values/", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await setCodeCryptographySecrets();
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "The Big Bucks",
            symbol: "$",
            decimalPlaces: 2
        });
    });

    it("can create a Value with deprecated properties `uses` and `valueRule` and both properties are returned", async () => {
    });

    // this should be implicitly tested through other tests but until valueRule and uses are totally gone, this is an assuring test
    it("can create a Value with new properties `usesRemaining` and `balanceRule` and both properties are returned", async () => {

    });

    describe("check using deprecated properties (valueRule, fixedInitialUses, uses) for program creation, one-off value creation, and issuance creation", () => {

        let program: Program;
        it("can create a Program with deprecated properties `fixedInitialUses` and `valueRule` and both properties are returned", async () => {

        });

        it("can updated Program properties `fixedInitialUses` and `valueRule` and both properties are returned", async () => {

        });

        it("can create a Value from Program with deprecated properties `fixedInitialUses` and `valueRule` and both properties are returned", async () => {

        });

        let issuance: Issuance;
        it("can create an Issuance with deprecated properties `uses` and `valueRule` and both properties are returned.", async () => {

            // values created have correct properties.
        });

        it("values created from issuance inherit deprecated and new properties `uses` and `valueRule`", async () => {

            // values created have correct properties.
        });
    });


    describe("check using new properties (balanceRule, fixedInitialUsesRemaining, usesRemaining) for program creation, one-off value creation, and issuance creation", () => {

        let program: Program;
        it("can create a Program with deprecated properties `fixedInitialUses` and `valueRule` and both properties are returned", async () => {

        });

        it("can create a Value from Program with deprecated properties `fixedInitialUses` and `valueRule` and both properties are returned", async () => {

        });

        let issuance: Issuance;
        it("can create an Issuance with deprecated properties `uses` and `valueRule` and both properties are returned.", async () => {

            // values created have correct properties.
        });

        it("values created from issuance inherit deprecated and new properties `uses` and `valueRule`", async () => {

            // values created have correct properties.
        });

    });

    // this should be implicitly tested through other tests but until valueRule and fixedInitialUses are totally gone, this is an assuring test
    it("can create a Program with new properties `fixedInitialUsesRemaining` and `balanceRule` and both properties are returned", async () => {

        // creating a value from program inherits properties correctly
    });

    it("can create an Issuance with deprecated properties `uses` and `valueRule` and both properties are returned.", async () => {

        // values created have correct properties.
    });

    // this should be implicitly tested through other tests but until valueRule and uses are totally gone, this is an assuring test
    it("can create an Issuance with new properties `usesRemaining` and `balanceRule` and both properties are returned", async () => {

        // values created have correct properties
    });
});
