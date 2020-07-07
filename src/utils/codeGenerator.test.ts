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

    describe("prefix and suffix", () => {
        it("generates codes using prefix & suffix", async () => {
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

        it("does not allow leading space in prefix", async () => {
            const prefix1 = " ABC";
            chai.assert.throws(() => {
                generateCode({prefix: prefix1});
            }, `Requested prefix ${prefix1} cannot have leading whitespace.`);

            const prefix2 = `\tABC`;
            chai.assert.throws(() => {
                generateCode({prefix: prefix2});
            }, `Requested prefix ${prefix2} cannot have leading whitespace.`);

            const prefix3 = `\nABC`;
            chai.assert.throws(() => {
                generateCode({prefix: prefix3});
            }, `Requested prefix ${prefix3} cannot have leading whitespace.`);
        });

        it("does not allow trailing space in suffix", async () => {
            const suffix1 = "ABC ";
            chai.assert.throws(() => {
                generateCode({suffix: suffix1});
            }, `Requested suffix ${suffix1} cannot have trailing whitespace.`);

            const suffix2 = "ABC\t";
            chai.assert.throws(() => {
                generateCode({suffix: suffix2});
            }, `Requested suffix ${suffix2} cannot have trailing whitespace.`);

            const suffix3 = "ABC\n";
            chai.assert.throws(() => {
                generateCode({suffix: suffix3});
            }, `Requested suffix ${suffix3} cannot have trailing whitespace.`);
        });
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

    it("does not allow charset to contain duplicates", async () => {
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

    it("cannot contain whitespace", async () => {
        const charset = "A BCDE";
        chai.assert.throws(() => {
            generateCode({charset: charset});
        }, `Requested charset ${charset} cannot contain whitespace.`);

        const charsetTab = `ABCD\tE`;
        chai.assert.throws(() => {
            generateCode({charset: charsetTab});
        }, `Requested charset ${charsetTab} cannot contain whitespace.`);

        const charsetNewline = `ABC\nDE`;
        chai.assert.throws(() => {
            generateCode({charset: charsetNewline});
        }, `Requested charset ${charsetNewline} cannot contain whitespace.`);
    });

    it("minimum length is 6", async () => {
        const length = 5;
        chai.assert.throws(() => {
            generateCode({length: length});
        }, `Requested code length ${length} doesn't meet minimum requirement of 6.`);
    });
});
