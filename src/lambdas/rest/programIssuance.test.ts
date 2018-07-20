import * as testUtils from "../../utils/testUtils";
import {generateId} from "../../utils/testUtils";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as cassava from "cassava";
import * as chai from "chai";
import {installRestRoutes} from "./installRestRoutes";
import {createCurrency} from "./currencies";
import {Program} from "../../model/Program";
import {Value} from "../../model/Value";
import {initializeCodeCryptographySecrets} from "../../utils/codeCryptoUtils";

describe.only("/v2/issuances", () => {

    const router = new cassava.Router();

    before(async () => {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        installRestRoutes(router);
        await initializeCodeCryptographySecrets(Promise.resolve({
            encryptionSecret: "ca7589aef4ffed15783341414fe2f4a5edf9ddad75cf2e96ed2a16aee88673ea",
            lookupHashSecret: "ae8645165cc7533dbcc84aeb21c7d6553a38271b7e3402f99d16b8a8717847e1"
        }));
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "US Dollars",
            symbol: "$",
            decimalPlaces: 2
        });

    });

    it(`test basic program with no balance constraints or value valueRule`, async () => {
        let program: Partial<Program> = {
            id: generateId(),
            name: "program with no balance constraints or valueRule",
            currency: "USD"
        };

        let programProperties = Object.keys(program);
        const createProgram = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
        chai.assert.equal(createProgram.statusCode, 201, JSON.stringify(createProgram.body));
        for (let prop of programProperties) {
            chai.assert.equal(createProgram.body[prop], program[prop]);
        }

        let issuance = {
            id: generateId(),
            count: 1000,
            generateCode: {}
        };

        const before = new Date();
        const createIssuance = await testUtils.testAuthedRequest<Program>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
        chai.assert.equal(createIssuance.statusCode, 201, JSON.stringify(createIssuance.body));
        const after = new Date();

        const listResponse = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?limit=1000`, "GET");
        chai.assert.equal(listResponse.statusCode, 200, `body=${JSON.stringify(listResponse.body)}`);
        console.log(JSON.stringify(listResponse, null, 4));
        console.log("Timing: " + (after.getTime() - before.getTime()) + "ms");
        chai.assert.equal(listResponse.body.length, issuance.count);
    }).timeout(10000);

    // todo - test with generating codes
    // todo - test with generic code
    // todo - test with generic code and count > 1


});
