import * as chai from "chai";
import * as codeCryptoUtils from "./codeCryptoUtils";
import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("test codeCryptographicUtils", () => {

    it("test encrypt and decrypt", async () => {
        const code = "ABCDEFGHIJKLMNOP";
        const encryptedCode = codeCryptoUtils.encrypt(code);
        chai.assert.notEqual(code, encryptedCode, `expected code ${code} to not equal encryptedCode ${encryptedCode}`);

        const decryptedCode = codeCryptoUtils.decrypt(encryptedCode);
        chai.assert.equal(code, decryptedCode, `expected code ${code} to equal encryptedCode ${encryptedCode}`);
    });

    it("test hash", async () => {
        const code = "ABCDEFGHIJKLMNOP";
        const badge: AuthorizationBadge = new AuthorizationBadge();
        badge.giftbitUserId = "user-123";
        const hash1 = codeCryptoUtils.computeLookupHash(code, badge);
        const hash2 = codeCryptoUtils.computeLookupHash(code, badge);
        console.log(hash1);
        console.log(hash2);
        chai.assert.equal(hash1, hash2, `expected hash1 ${hash1} to equal ${hash2}`)
    });

    it("generate key", async () => {
        codeCryptoUtils.generateKey();
        codeCryptoUtils.generateKey();
        codeCryptoUtils.generateKey();
        codeCryptoUtils.generateKey();
    })
});
