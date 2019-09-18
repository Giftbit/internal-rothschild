import * as chai from "chai";
import {generateCode} from "./codeGenerator";
import chaiExclude from "chai-exclude";

chai.use(chaiExclude);

const ALPHANUMERIC_CHARSET = "ABCDEFGHIJKLMNPQRSTUVWXYZ123456789"; // uppercase generator omits 0O
const NUMERIC_CHARSET = "1234567890";
describe("code generator tests", () => {

    it("test alphanumeric code generation", async () => {
        for (let i = 0; i < 100; i++) {
            const length = 6 + (i % 20);
            const res = generateCode({length: length});
            chai.assert.isNotNull(res);
            chai.assert.equal(res.length, length);
            for (let j = 0; j < length; j++) {
                chai.assert.include(ALPHANUMERIC_CHARSET, res.charAt(j));
            }
        }
        for (let i = 0; i < 100; i++) {
            const length = 6 + (i % 20);
            const res = generateCode({length: length, charset: ALPHANUMERIC_CHARSET});
            chai.assert.isNotNull(res);
            chai.assert.equal(res.length, length);
            for (let j = 0; j < length; j++) {
                chai.assert.include(ALPHANUMERIC_CHARSET, res.charAt(j));
            }
        }
    });

    it("test numeric code generation", async () => {
        for (let i = 0; i < 100; i++) {
            const length = 6 + (i % 20);
            const res = generateCode({length: length, charset: NUMERIC_CHARSET});
            chai.assert.isNotNull(res);
            chai.assert.equal(res.length, length);
            for (let j = 0; j < length; j++) {
                chai.assert.include(NUMERIC_CHARSET, res.charAt(j));
            }
        }
    });

    it("test prefix and suffix", async () => {
        const prefix = "prefix";
        const suffix = "suffix";
        for (let i = 0; i < 100; i++) {
            const length = 6 + (i % 20);
            const res = generateCode({length: length, prefix: prefix, suffix: suffix});
            chai.assert.isNotNull(res);
            chai.assert.equal(res.substring(0, prefix.length), prefix);
            const generatedCode = res.substring(prefix.length, prefix.length + length);
            for (let j = 0; j < length; j++) {
                chai.assert.include(ALPHANUMERIC_CHARSET, generatedCode.charAt(j));
            }
            chai.assert.equal(res.substring(prefix.length + length), suffix);
        }
    });

    it("test custom charset", async () => {
        const charset = "ABCDE";
        for (let i = 0; i < 100; i++) {
            const length = 6 + (i % 20);
            const res = generateCode({length: length, charset: charset});
            chai.assert.equal(res.length, length);
            for (let j = 0; j < length; j++) {
                chai.assert.include(charset, res.charAt(j));
            }
        }

        const charsetLowercase = "abc123";
        for (let i = 0; i < 100; i++) {
            const length = 6 + (i % 20);
            const res = generateCode({length: length, charset: charsetLowercase});
            chai.assert.equal(res.length, length);
            for (let j = 0; j < length; j++) {
                chai.assert.include(charsetLowercase, res.charAt(j));
            }
        }
    });

    it("contains duplciates", async () => {
        const charset = "AABCDE";
        chai.assert.throws(() => {
            generateCode({charset: charset});
        }, `Requested charset ${charset} contains duplicates.`);
    });

    it("minimum charset size is 5", async () => {
        const charset = "ABCD";
        chai.assert.throws(() => {
            generateCode({charset: charset});
        }, `Requested charset ${charset} doesn't meet minimum charset size requirement of 5.`);
    });

    it("cannot contain a space", async () => {
        const charset = "A BCDE";
        chai.assert.throws(() => {
            generateCode({charset: charset});
        }, `Requested charset ${charset} cannot contain whitespace.`);
    });

    it("minimum length is 6", async () => {
        const length = 5;
        chai.assert.throws(() => {
            generateCode({length: length});
        }, `Requested code length ${length} doesn't meet minimum requirement of 6.`);
    });
});
