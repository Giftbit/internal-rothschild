import * as chai from "chai";
import * as codeCryptoUtils from "./codeCryptoUtils";
import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("test codeCryptographicUtils", () => {
    const codes = ["ABCDEFGHIJKLMNOP", "10011011", "short", "a1x2bc3f305402", "1334123"];

    it("test encrypt and decrypt", async () => {
        for (let code of codes) {
            const encryptedCode = codeCryptoUtils.encrypt(code);
            chai.assert.notEqual(code, encryptedCode, `expected code ${code} to not equal encryptedCode ${encryptedCode}`);

            const decryptedCode = codeCryptoUtils.decrypt(encryptedCode);
            chai.assert.equal(code, decryptedCode, `expected code ${code} to equal encryptedCode ${encryptedCode}`);
        }
    });

    it("test hash", async () => {
        for (let code of codes) {
            const badge: AuthorizationBadge = new AuthorizationBadge();
            badge.giftbitUserId = "user-123";
            const hash1 = codeCryptoUtils.computeLookupHash(code, badge);
            const hash2 = codeCryptoUtils.computeLookupHash(code, badge);
            chai.assert.equal(hash1, hash2, `expected hash1 ${hash1} to equal ${hash2}`)
        }
    });

    it("test addCodebasePepperToCode", async () => {
        for (let code of codes) {
            const codeWithPepper = codeCryptoUtils.addCodebasePepperToCode(code);
            const codeWithoutPepper = codeCryptoUtils.removeCodebasePepperFromDecryptedCode(codeWithPepper);
            chai.assert.equal(code, codeWithoutPepper);
            chai.assert.notEqual(code, codeWithPepper);
        }
    });

    it("generate key", async () => {
        codeCryptoUtils.generateKey();
        codeCryptoUtils.generateKey();
        codeCryptoUtils.generateKey();
        codeCryptoUtils.generateKey();
    })
});
