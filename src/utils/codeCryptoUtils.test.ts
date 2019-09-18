import * as chai from "chai";
import * as codeCryptoUtils from "./codeCryptoUtils";
import {initializeCodeCryptographySecrets} from "./codeCryptoUtils";
import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";
import chaiExclude from "chai-exclude";

chai.use(chaiExclude);

describe("test codeCryptographicUtils", () => {
    const codes = ["ABCDEFGHIJKLMNOP", "10011011", "short", "a1x2bc3f305402", "1334123", "⻥⻧⻕⻓", "🧝🧜‍🙍🙆‍🏌"];

    before(async function () {
        initializeCodeCryptographySecrets(Promise.resolve({
            encryptionSecret: "ca7589aef4ffed15783341414fe2f4a5edf9ddad75cf2e96ed2a16aee88673ea",
            lookupHashSecret: "ae8645165cc7533dbcc84aeb21c7d6553a38271b7e3402f99d16b8a8717847e1"
        }));
    });

    it("test encryptCode and decryptCode", async () => {
        for (let code of codes) {
            const codeEncrypted = await codeCryptoUtils.encryptCode(code);
            chai.assert.notEqual(code, codeEncrypted, `expected code ${code} to not equal codeEncrypted ${codeEncrypted}`);

            const decryptedCode = await codeCryptoUtils.decryptCode(codeEncrypted);
            chai.assert.equal(code, decryptedCode, `expected code ${code} to equal codeEncrypted ${codeEncrypted}`);
        }
    });

    it("test hash", async () => {
        for (let code of codes) {
            const badge: AuthorizationBadge = new AuthorizationBadge();
            badge.userId = "user-123";
            const hash1 = await codeCryptoUtils.computeCodeLookupHash(code, badge);
            const hash2 = await codeCryptoUtils.computeCodeLookupHash(code, badge);
            chai.assert.equal(hash1, hash2, `expected hash1 ${hash1} to equal ${hash2}`);
        }
    });

    it("test addCodebasePepperToCode", async () => {
        for (let code of codes) {
            const codeWithPepper = await codeCryptoUtils.addCodebasePepperToCode(code);
            const codeWithoutPepper = await codeCryptoUtils.removeCodebasePepperFromDecryptedCode(codeWithPepper);
            chai.assert.equal(code, codeWithoutPepper);
            chai.assert.notEqual(code, codeWithPepper);
        }
    });
});
