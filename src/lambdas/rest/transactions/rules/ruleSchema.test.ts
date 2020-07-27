import * as chai from "chai";
import * as jsonschema from "jsonschema";
import {RouterEvent} from "cassava";
import {ruleSchema} from "./ruleSchema";

describe("ruleSchema", () => {

    const exampleSchema: jsonschema.Schema = {
        type: "object",
        properties: {
            exampleRule: {
                ...ruleSchema
            }
        }
    };
    
    it("can validate rule", () => {
        const evt = new RouterEvent();
        evt.body = {
            exampleRule: {
                rule: "500",
                explanation: "okay"
            }
        };
        chai.assert.doesNotThrow(() => {
            evt.validateBody(exampleSchema);
        });
    });

    it("can't validate if missing rule", () => {
        const evt = new RouterEvent();
        evt.body = {
            exampleRule: {
                explanation: "okay"
            }
        };
        chai.assert.throws(() => {
            evt.validateBody(exampleSchema);
        }, "The undefined body has 1 validation error(s): requestBody.exampleRule requires property \"rule\".");
    });

    it("can't validate if missing explanation", () => {
        const evt = new RouterEvent();
        evt.body = {
            exampleRule: {
                rule: "500"
            }
        };
        chai.assert.throws(() => {
            evt.validateBody(exampleSchema);
        }, "The undefined body has 1 validation error(s): requestBody.exampleRule requires property \"explanation\".");
    });

    it("can't have additionalProperties in rule", () => {
        const evt = new RouterEvent();
        evt.body = {
            exampleRule: {
                rule: "500",
                explanation: "okay",
                extra: "get your extra"
            }
        };
        chai.assert.throws(() => {
            evt.validateBody(exampleSchema);
        }, "The undefined body has 1 validation error(s): requestBody.exampleRule additionalProperty \"extra\" exists in instance when not allowed.");
    });

    it("can have null rule", () => {
        const evt = new RouterEvent();
        evt.body = {
            exampleRule: null
        };
        chai.assert.doesNotThrow(() => {
            evt.validateBody(exampleSchema);
        });
    });

    it("can have undefined rule", () => {
        const evt = new RouterEvent();
        evt.body = {
            exampleRule: undefined
        };
        chai.assert.doesNotThrow(() => {
            evt.validateBody(exampleSchema);
        });
    });
});
